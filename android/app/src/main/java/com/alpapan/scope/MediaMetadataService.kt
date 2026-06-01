package com.alpapan.scope

import android.content.ComponentName
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.service.notification.NotificationListenerService
import android.util.Base64
import java.io.ByteArrayOutputStream

class MediaMetadataService : NotificationListenerService() {

    private val msm by lazy { getSystemService(MediaSessionManager::class.java) }
    private val self by lazy { ComponentName(this, MediaMetadataService::class.java) }
    private var lastKey: String? = null

    private val sessionsListener = MediaSessionManager.OnActiveSessionsChangedListener { controllers ->
        publish(controllers ?: emptyList())
    }
    private val controllerCb = object : MediaController.Callback() {
        override fun onMetadataChanged(metadata: MediaMetadata?) { refresh() }
        override fun onPlaybackStateChanged(state: PlaybackState?) { refresh() }
    }

    override fun onListenerConnected() {
        try {
            msm.addOnActiveSessionsChangedListener(sessionsListener, self)
            refresh()
        } catch (_: Throwable) {}
    }

    override fun onListenerDisconnected() {
        try { msm.removeOnActiveSessionsChangedListener(sessionsListener) } catch (_: Throwable) {}
    }

    private fun refresh() {
        try { publish(msm.getActiveSessions(self)) } catch (_: Throwable) {}
    }

    private fun publish(controllers: List<MediaController>) {
        for (c in controllers) { try { c.registerCallback(controllerCb) } catch (_: Throwable) {} }
        // getActiveSessions returns most-recent first, so a smaller index is more
        // recent; (size - i) makes a larger lastActive mean more recent.
        val infos = controllers.mapIndexed { i, c ->
            val playing = c.playbackState?.state == PlaybackState.STATE_PLAYING
            SessionInfo(c.packageName ?: "", playing, (controllers.size - i).toLong())
        }
        val chosenInfo = NowPlayingLogic.selectActiveSession(infos)
        val chosen = chosenInfo?.let { ci ->
            controllers.firstOrNull { it.packageName == ci.pkg && it.playbackState?.state == PlaybackState.STATE_PLAYING }
        }
        val md = chosen?.metadata
        val np = NowPlayingLogic.build(
            md?.getString(MediaMetadata.METADATA_KEY_TITLE),
            md?.getString(MediaMetadata.METADATA_KEY_ARTIST),
            md?.getString(MediaMetadata.METADATA_KEY_ALBUM),
            md?.let { encodeArt(it) },
        )
        val key = np?.let { it.title + "" + it.artist + "" + it.album }
        if (key == lastKey) return
        lastKey = key
        ScopeAudioPlugin.instance?.emitNowPlaying(np)
    }

    private fun encodeArt(md: MediaMetadata): String? {
        val bmp: Bitmap = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
            ?: md.getBitmap(MediaMetadata.METADATA_KEY_ART)
            ?: md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
            ?: return null
        return try {
            val (w, h) = NowPlayingLogic.artTargetSize(bmp.width, bmp.height, 384)
            if (w <= 0) return null
            val scaled = Bitmap.createScaledBitmap(bmp, w, h, true)
            val out = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, 80, out)
            val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            // If even after downscale the art blows the wire budget, drop it
            // (text-only) rather than sending a huge frame.
            if (NowPlayingLogic.shouldDropArt(b64.length, 65536)) null else b64
        } catch (_: Throwable) { null }
    }
}
