package com.alpapan.scope.tv
import org.junit.Assert.*
import org.junit.Test

class ControlRouterTest {
    @Test fun route_renderRequest_returnsApplyRequest() {
        val json = "{\"type\":\"render-request\",\"view\":1}"
        assertEquals(PhoneInboundAction.ApplyRequest(json), ControlRouter.route(json))
    }
    @Test fun route_remoteViewRequest_returnsForwardWithView() {
        val json = "{\"type\":\"remote-view-request\",\"view\":2}"
        assertEquals(PhoneInboundAction.ForwardViewRequest(2), ControlRouter.route(json))
    }
    @Test fun route_unknownType_returnsDrop() {
        val json = "{\"type\":\"unknown-future-type\",\"view\":0}"
        assertEquals(PhoneInboundAction.Drop, ControlRouter.route(json))
    }
    @Test fun route_malformedJson_returnsDrop() {
        assertEquals(PhoneInboundAction.Drop, ControlRouter.route("not json"))
    }
    @Test fun route_remoteViewRequestMissingViewField_returnsDrop() {
        val json = "{\"type\":\"remote-view-request\"}"
        assertEquals(PhoneInboundAction.Drop, ControlRouter.route(json))
    }
}
