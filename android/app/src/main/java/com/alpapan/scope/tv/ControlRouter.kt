package com.alpapan.scope.tv
import org.json.JSONObject

/** Action returned by [ControlRouter.route]. Caller switches on the variant. */
sealed class PhoneInboundAction {
    data class ApplyRequest(val json: String) : PhoneInboundAction()
    data class ForwardViewRequest(val view: Int) : PhoneInboundAction()
    object Drop : PhoneInboundAction()
}

/** Pure dispatcher for the phone's inbound control channel. Discriminates the
 *  type-0 JSON payload by its `type` field; never has side effects. Testable
 *  without mocking our own modules. */
object ControlRouter {
    fun route(json: String): PhoneInboundAction = try {
        val obj = JSONObject(json)
        when (obj.optString("type")) {
            "render-request" -> PhoneInboundAction.ApplyRequest(json)
            "remote-view-request" -> {
                if (!obj.has("view")) PhoneInboundAction.Drop
                else PhoneInboundAction.ForwardViewRequest(obj.getInt("view"))
            }
            else -> PhoneInboundAction.Drop
        }
    } catch (_: Throwable) { PhoneInboundAction.Drop }
}
