package com.alpapan.scope

import java.io.File

/**
 * Per-shot diagnostics. Written as a JSON sidecar next to every screenshot
 * (whether the shot succeeded or failed). On FTL, this is the only postmortem
 * surface: re-running is not free, and the artifact has to be self-explaining.
 */
data class GatingDiagnostics(
    val shotName: String,
    val lifecycleState: String,         // RESUMED / STARTED / CREATED / STOPPED / DESTROYED / INITIALIZED
    val currentPackage: String,         // UiDevice.currentPackageName at gate time
    val focusedWindow: String,          // dumpsys window | grep mCurrentFocus
    val paintLatchSignaled: Boolean,    // postVisualStateCallback fired before deadline
    val domPredicate: String?,          // the JS predicate (null for dialog/screen shots)
    val domPredicateValue: String?,     // its final evaluated value
    val wasGated: Boolean,              // true iff all gates passed
    val failureReason: String?,         // null on success
    val timestampMs: Long,
) {
    fun toJsonString(): String = buildString {
        append('{')
        appendJsonString("shotName", shotName); append(',')
        appendJsonString("lifecycleState", lifecycleState); append(',')
        appendJsonString("currentPackage", currentPackage); append(',')
        appendJsonString("focusedWindow", focusedWindow); append(',')
        append("\"paintLatchSignaled\":").append(paintLatchSignaled); append(',')
        appendJsonStringNullable("domPredicate", domPredicate); append(',')
        appendJsonStringNullable("domPredicateValue", domPredicateValue); append(',')
        append("\"wasGated\":").append(wasGated); append(',')
        appendJsonStringNullable("failureReason", failureReason); append(',')
        append("\"timestampMs\":").append(timestampMs)
        append('}')
    }

    private fun StringBuilder.appendJsonString(k: String, v: String) {
        append('"').append(k).append("\":\"")
        for (c in v) {
            when {
                c == '\\' -> append("\\\\")
                c == '"' -> append("\\\"")
                c == '\n' -> append("\\n")
                c == '\r' -> append("\\r")
                c == '\t' -> append("\\t")
                c < ' ' -> append("\\u").append("%04x".format(c.code))
                else -> append(c)
            }
        }
        append('"')
    }

    private fun StringBuilder.appendJsonStringNullable(k: String, v: String?) {
        if (v == null) { append('"').append(k).append("\":null") } else { appendJsonString(k, v) }
    }
}

sealed class ShotResult {
    data class Success(val file: File, val diagnostics: GatingDiagnostics) : ShotResult()
    data class Failure(val reason: String, val diagnostics: GatingDiagnostics) : ShotResult()
}
