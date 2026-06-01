package com.alpapan.scope

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject

class NowPlayingTest {
    @Test fun build_allBlank_returnsNull() {
        assertNull(NowPlayingLogic.build("", "  ", null, null))
    }
    @Test fun build_trimsAndKeepsNonBlank() {
        val np = NowPlayingLogic.build(" Song ", "Band", "", "ZZ")!!
        assertEquals("Song", np.title)
        assertEquals("Band", np.artist)
        assertEquals("", np.album)
        assertEquals("ZZ", np.art)
    }
    @Test fun build_emptyArtBecomesNull() {
        // !! is safe here: a non-empty title guarantees build returns non-null;
        // the assertion under test is that empty art collapses to null.
        assertNull(NowPlayingLogic.build("Song", null, null, "")!!.art)
    }
    @Test fun selectActiveSession_prefersPlaying_thenMostRecent() {
        val none = listOf(SessionInfo("a", false, 5), SessionInfo("b", false, 9))
        assertNull(NowPlayingLogic.selectActiveSession(none))
        val mixed = listOf(SessionInfo("a", true, 5), SessionInfo("b", true, 9), SessionInfo("c", false, 99))
        assertEquals("b", NowPlayingLogic.selectActiveSession(mixed)!!.pkg)
    }
    @Test fun encodeMessage_roundTripsThroughJson() {
        val json = NowPlayingLogic.encodeMessage(NowPlaying("Song", "Band", "LP", "ZZ"))
        val o = JSONObject(json)
        assertEquals("now-playing", o.getString("type"))
        assertEquals("Song", o.getString("title"))
        assertEquals("ZZ", o.getString("art"))
    }
    @Test fun encodeMessage_omitsArtWhenNull() {
        val o = JSONObject(NowPlayingLogic.encodeMessage(NowPlaying("S", "B", "L", null)))
        assertFalse(o.has("art"))
    }
    @Test fun artTargetSize_scalesLongestSideToMax() {
        assertEquals(384 to 192, NowPlayingLogic.artTargetSize(800, 400, 384))
        assertEquals(200 to 200, NowPlayingLogic.artTargetSize(200, 200, 384)) // already small
        assertEquals(0 to 0, NowPlayingLogic.artTargetSize(0, 0, 384))
    }
    @Test fun shouldDropArt_overCap() {
        assertTrue(NowPlayingLogic.shouldDropArt(70000, 65536))
        assertFalse(NowPlayingLogic.shouldDropArt(40000, 65536))
    }
}
