package com.alpapan.scope

import org.json.JSONObject

data class NowPlaying(val title: String, val artist: String, val album: String, val art: String?)

/** Plain record for session selection so the heuristic is JVM-testable without MediaController. */
data class SessionInfo(val pkg: String, val isPlaying: Boolean, val lastActive: Long)

object NowPlayingLogic {
    /** Returns null when title/artist/album are all blank (the canonical "nothing
     *  playing" signal); otherwise a trimmed NowPlaying with empty art collapsed to null. */
    fun build(title: String?, artist: String?, album: String?, art: String?): NowPlaying? {
        val t = title?.trim().orEmpty()
        val ar = artist?.trim().orEmpty()
        val al = album?.trim().orEmpty()
        if (t.isEmpty() && ar.isEmpty() && al.isEmpty()) return null
        return NowPlaying(t, ar, al, if (art.isNullOrEmpty()) null else art)
    }

    /** A PLAYING session wins; on ties the most recently active. None playing -> null. */
    fun selectActiveSession(sessions: List<SessionInfo>): SessionInfo? {
        val playing = sessions.filter { it.isPlaying }
        if (playing.isEmpty()) return null
        return playing.maxByOrNull { it.lastActive }
    }

    fun encodeMessage(np: NowPlaying): String {
        val o = JSONObject()
        o.put("type", "now-playing")
        o.put("title", np.title)
        o.put("artist", np.artist)
        o.put("album", np.album)
        if (np.art != null) o.put("art", np.art)
        return o.toString()
    }

    /** Fit (srcW,srcH) within maxDim on the longest side, preserving aspect. */
    fun artTargetSize(srcW: Int, srcH: Int, maxDim: Int): Pair<Int, Int> {
        if (srcW <= 0 || srcH <= 0) return 0 to 0
        val longest = maxOf(srcW, srcH)
        if (longest <= maxDim) return srcW to srcH
        val scale = maxDim.toDouble() / longest
        return maxOf(1, (srcW * scale).toInt()) to maxOf(1, (srcH * scale).toInt())
    }

    fun shouldDropArt(encodedLen: Int, capBytes: Int): Boolean = encodedLen > capBytes
}
