package com.alpapan.scope

import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * now-playing reads media-session metadata via MediaMetadataService (a NotificationListenerService).
 * Two things are required and neither is automatic in a test: (1) notification-listener access,
 * granted in setup; (2) an active MediaSession to read. Instrumentation runs inside the app's own
 * process, so a MediaSession created here is owned by com.alpapan.scope and the app's own listener
 * can enumerate it. This proves the now-playing view renders real metadata, not an empty card.
 */
@RunWith(AndroidJUnit4::class)
class NowPlayingTest {
    private lateinit var s: ActivityScenario<MainActivity>
    private var session: MediaSession? = null

    @Before fun setup() {
        JourneySupport.resetApp()
        JourneySupport.grantMic()
        JourneySupport.grantNotificationAccess()
    }
    @After fun tearDown() {
        try { session?.isActive = false; session?.release() } catch (_: Throwable) {}
        if (::s.isInitialized) s.close()
    }

    @Test fun nowPlayingShowsMediaMetadata() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        session = MediaSession(ctx, "scope-instr-test").apply {
            setMetadata(
                MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, "Scope Test Track")
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, "Scope Test Artist")
                    .putString(MediaMetadata.METADATA_KEY_ALBUM, "Scope Test Album")
                    .build(),
            )
            setPlaybackState(
                PlaybackState.Builder()
                    .setState(PlaybackState.STATE_PLAYING, 0L, 1.0f)
                    .setActions(PlaybackState.ACTION_PLAY)
                    .build(),
            )
            isActive = true
        }

        s = JourneySupport.launchReady()
        JourneySupport.startSystemCapture(s)
        JourneySupport.cycleToView(s, "nowplaying")

        // The card pulls metadata from MediaMetadataService via the Capacitor plugin; the
        // listener binds after the grant and fires on the active session. The gate's predicate
        // is the title check (12s budget for the listener bind), and the screenshot only lands
        // once the title is actually on the now-playing card.
        val r = JourneySupport.proveScopeState(s, "nowplaying-01-metadata", "/Scope Test Track/i.test(document.body.innerText)", timeoutMs = 12000)
        check(r is ShotResult.Success) { "nowplaying metadata gate failed: ${(r as ShotResult.Failure).reason}" }
    }
}
