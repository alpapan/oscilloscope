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

    companion object {
        // Latest computed now-playing, cached so the plugin's getNowPlaying pull
        // can return the current track even when no change event is pending.
        @Volatile var latest: NowPlaying? = null
        // The currently-chosen playing controller, exposed so the plugin can
        // drive transport (skipToNext/Previous) without a new permission.
        @Volatile var active: MediaController? = null
    }

    private val msm by lazy { getSystemService(MediaSessionManager::class.java) }
    private val self by lazy { ComponentName(this, MediaMetadataService::class.java) }
    private var lastKey: String? = null
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
    // Controllers we have attached callbacks to, RETAINED. A track change within
    // a session is delivered only via the per-controller callback (the session
    // list listener fires on set changes, not metadata changes); if the
    // controllers are not retained they are GC'd and updates silently stop.
    private val registered = mutableListOf<MediaController>()

    private val sessionsListener = MediaSessionManager.OnActiveSessionsChangedListener { controllers ->
        val list = controllers ?: emptyList()
        registerControllers(list)
        publish(list)
    }
    private val controllerCb = object : MediaController.Callback() {
        override fun onMetadataChanged(metadata: MediaMetadata?) { refresh() }
        override fun onPlaybackStateChanged(state: PlaybackState?) { refresh() }
        override fun onSessionDestroyed() { refresh() }
    }

    override fun onListenerConnected() {
        try {
            msm.addOnActiveSessionsChangedListener(sessionsListener, self)
            val controllers = msm.getActiveSessions(self)
            registerControllers(controllers)
            publish(controllers)
        } catch (_: Throwable) {}
    }

    override fun onListenerDisconnected() {
        for (c in registered) { try { c.unregisterCallback(controllerCb) } catch (_: Throwable) {} }
        registered.clear()
        try { msm.removeOnActiveSessionsChangedListener(sessionsListener) } catch (_: Throwable) {}
        latest = null
        active = null
    }

    /** Attach the metadata callback to the current controllers and retain them
     *  (called only on session-set changes; metadata changes recompute via
     *  refresh() without re-registering). */
    private fun registerControllers(controllers: List<MediaController>) {
        for (c in registered) { try { c.unregisterCallback(controllerCb) } catch (_: Throwable) {} }
        registered.clear()
        for (c in controllers) {
            try { c.registerCallback(controllerCb, mainHandler) } catch (_: Throwable) {}
            registered.add(c)
        }
    }

    private fun refresh() {
        try { publish(msm.getActiveSessions(self)) } catch (_: Throwable) {}
    }

    private fun publish(controllers: List<MediaController>) {
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
        active = chosen
        val md = chosen?.metadata
        val np = NowPlayingLogic.build(
            md?.getString(MediaMetadata.METADATA_KEY_TITLE),
            md?.getString(MediaMetadata.METADATA_KEY_ARTIST),
            md?.getString(MediaMetadata.METADATA_KEY_ALBUM),
            md?.let { encodeArt(it) },
        )
        latest = np                       // cache for the pull, even when unchanged
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
