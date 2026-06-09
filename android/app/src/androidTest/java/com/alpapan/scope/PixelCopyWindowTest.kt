package com.alpapan.scope

import android.graphics.Bitmap
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class PixelCopyWindowTest {
    private lateinit var s: ActivityScenario<MainActivity>
    @After fun tearDown() { if (::s.isInitialized) s.close() }

    @Test fun pixelCopyWindow_capturesNonBlankBitmap() {
        s = JourneySupport.launchReady()
        // Paint a known colour the capture MUST reflect. Scope renders a full-screen
        // PixiJS <canvas id="stage"> (plus the nowplaying card) that paints over
        // document.body, so a body background is occluded. Deliver the colour via a
        // top-most fixed overlay that actually composites into the WebView frame -
        // this proves pixelCopyWindow captures the LIVE composited window content.
        JourneySupport.eval(
            s,
            "var d=document.getElementById('__pcw');" +
                "if(!d){d=document.createElement('div');d.id='__pcw';document.body.appendChild(d);}" +
                "d.style.cssText='position:fixed;left:0;top:0;right:0;bottom:0;background:#3366cc;z-index:2147483647';" +
                "'ok'",
        )
        JourneySupport.awaitFrameCommitted(s)
        val outDir = File(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null), "pixelcopy-test").apply { mkdirs() }
        val out = File(outDir, "blue.png")
        val bmp: Bitmap? = JourneySupport.pixelCopyWindow(s)
        assertNotNull("pixelCopy must return a Bitmap", bmp)
        java.io.FileOutputStream(out).use { bmp!!.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertTrue("file written", out.length() > 0)
        // Sample-check: average centre 16x16 pixel should be bluish.
        val w = bmp!!.width; val h = bmp.height
        var rsum = 0L; var gsum = 0L; var bsum = 0L
        for (y in (h/2 - 8) until (h/2 + 8)) for (x in (w/2 - 8) until (w/2 + 8)) {
            val c = bmp.getPixel(x, y)
            rsum += (c shr 16) and 0xff
            gsum += (c shr 8) and 0xff
            bsum += c and 0xff
        }
        // Blue dominant; allow generous tolerance for compositor blends. The message
        // reports the sampled centre averages so any failure is self-diagnosing
        // (all-black => capture broken; some other colour => wrong surface).
        val n = 16L * 16L
        assertTrue(
            "blue > red at centre (avg r=${rsum / n} g=${gsum / n} b=${bsum / n})",
            bsum > rsum + 40 * 256,
        )
    }
}
