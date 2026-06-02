package com.alpapan.scope.tv

// Accept-loop resilience: keep accepting while the service is running and the
// server socket is open. A transient accept() error must not kill the listener;
// only shutdown (running=false) or a closed socket stops it.
object AcceptPolicy {
    fun shouldRetry(running: Boolean, serverClosed: Boolean): Boolean = running && !serverClosed
}
