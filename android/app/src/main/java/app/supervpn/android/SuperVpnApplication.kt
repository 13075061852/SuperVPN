package app.supervpn.android

import android.app.Application
import app.supervpn.android.data.CrashGuard
import app.supervpn.android.data.Runtime
import app.supervpn.android.data.Store

class SuperVpnApplication : Application() {
    val store: Store by lazy { Store(this) }

    override fun onCreate() {
        super.onCreate()
        CrashGuard.install(this)
        runCatching {
            Runtime.attach(store)
        }.onFailure { err ->
            CrashGuard.record(this, "Application.onCreate", err)
            Runtime.lastError = "初始化异常：${err.message ?: err.javaClass.simpleName}"
        }
    }
}
