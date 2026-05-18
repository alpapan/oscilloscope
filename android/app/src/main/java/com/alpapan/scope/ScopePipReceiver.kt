package com.alpapan.scope

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ScopePipReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_CYCLE_VIEW = "com.alpapan.scope.action.CYCLE_VIEW"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_CYCLE_VIEW) return
        val plugin = ScopeAudioPlugin.instance ?: return
        val webView = plugin.bridge?.webView ?: return
        webView.post {
            webView.evaluateJavascript("window.cycleView && window.cycleView(1)", null)
        }
    }
}
