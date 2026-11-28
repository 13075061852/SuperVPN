package app.supervpn.android.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.IpPrefix
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import app.supervpn.android.MainActivity
import app.supervpn.android.R
import app.supervpn.android.core.AndroidPlatform
import app.supervpn.android.data.ClashApiClient
import app.supervpn.android.data.CrashGuard
import app.supervpn.android.data.Runtime
import go.Seq
import io.nekohasekai.libbox.BoxService
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.RoutePrefixIterator
import io.nekohasekai.libbox.SetupOptions
import io.nekohasekai.libbox.TunOptions
import java.io.File
import java.net.InetAddress
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Foreground VpnService that hosts the sing-box core through libbox.
 * A connection is only reported after the core started successfully; failures
 * stop the tunnel and surface the real error instead of a fake success.
 */
class SuperVpnService : VpnService() {
    private var service: BoxService? = null
    private var tunnel: ParcelFileDescriptor? = null
    private val locker = Any()
    private val trafficRunning = AtomicBoolean(false)

    override fun onCreate() {
        super.onCreate()
        runCatching { startForegroundNotification("正在准备 VPN 服务") }
            .onFailure { err -> CrashGuard.record(this, "SuperVpnService.onCreate", err) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            disconnect("已断开连接")
            return START_NOT_STICKY
        }
        val config = intent?.getStringExtra(EXTRA_CONFIG)
        val nodeId = intent?.getStringExtra(EXTRA_NODE_ID)
        val nodeName = intent?.getStringExtra(EXTRA_NODE_NAME)
        if (config.isNullOrEmpty()) {
            disconnect("缺少连接配置")
            return START_NOT_STICKY
        }
        connect(config, nodeId, nodeName)
        return START_STICKY
    }

    private fun connect(config: String, nodeId: String?, nodeName: String?) {
        val existing = synchronized(locker) {
            val prev = service
            service = null
            prev
        }
        trafficRunning.set(false)
        if (existing != null) {
            runCatching { existing.close() }
            closeTunnel()
        }

        Runtime.updateConnectionState(
            isConnected = false,
            isBusy = true,
            statusText = "正在连接",
            error = null,
        )
        runCatching { startForegroundNotification("正在连接 ${nodeName ?: "代理节点"}") }

        thread(name = "supervpn-connect") {
            try {
                setupLibbox()
                val platform = object : AndroidPlatform(this@SuperVpnService) {
                    override fun openTunnel(options: TunOptions): Int = establishTunnel(options)
                    override fun protectSocket(fd: Int): Boolean = protect(fd)
                }
                Libbox.checkConfig(config)
                val created = Libbox.newService(config, platform)
                created.start()
                synchronized(locker) { service = created }
                Runtime.updateConnectionState(
                    isConnected = true,
                    isBusy = false,
                    statusText = "已连接",
                    error = null,
                    nodeId = nodeId,
                    nodeName = nodeName,
                )
                Runtime.appendLog("内核已启动，已连接到 ${nodeName ?: "所选节点"}")
                runCatching { startForegroundNotification("已连接 · ${nodeName ?: "SuperVPN"}") }
                startTrafficMonitor()
            } catch (e: Throwable) {
                CrashGuard.record(this@SuperVpnService, "SuperVpnService.connect", e)
                val message = e.message ?: e.javaClass.simpleName
                Runtime.appendLog("连接失败：$message", level = "error")
                closeTunnel()
                synchronized(locker) {
                    runCatching { service?.close() }
                    service = null
                }
                Runtime.updateConnectionState(
                    isConnected = false,
                    isBusy = false,
                    statusText = "未连接",
                    error = message,
                )
                stopSelfSafely()
            }
        }
    }

    private fun startTrafficMonitor() {
        trafficRunning.set(true)
        thread(name = "supervpn-traffic", isDaemon = true) {
            try { Thread.sleep(400) } catch (_: InterruptedException) { return@thread }
            while (trafficRunning.get() && synchronized(locker) { service != null }) {
                ClashApiClient.streamTraffic(
                    onSample = { sample -> Runtime.recordTrafficSample(sample) },
                    isActive = { trafficRunning.get() && synchronized(locker) { service != null } },
                )
                if (!trafficRunning.get()) break
                try { Thread.sleep(1000) } catch (_: InterruptedException) { break }
            }
        }
    }

    fun disconnect(reason: String? = null) {
        trafficRunning.set(false)
        val current = synchronized(locker) {
            val value = service
            service = null
            value
        }
        runCatching { current?.close() }
        closeTunnel()
        Runtime.updateConnectionState(
            isConnected = false,
            isBusy = false,
            statusText = "未连接",
            error = null,
        )
        if (reason != null) {
            Runtime.appendLog(reason)
        }
        stopSelfSafely()
    }

    private fun stopSelfSafely() {
        runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
        stopSelf()
    }

    private fun setupLibbox() {
        Seq.setContext(applicationContext)
        val baseDir = filesDir
        val workingDir = File(baseDir, "working").apply { mkdirs() }
        val tempDir = File(baseDir, "temp").apply { mkdirs() }
        if (libboxInitialized.compareAndSet(false, true)) {
            val options = SetupOptions()
            options.setBasePath(baseDir.absolutePath)
            options.setWorkingPath(workingDir.absolutePath)
            options.setTempPath(tempDir.absolutePath)
            options.setFixAndroidStack(true)
            Libbox.setup(options)
        }
    }

    private fun establishTunnel(options: TunOptions): Int {
        if (prepare(this) != null) {
            throw IllegalStateException("缺少系统 VPN 授权，请重新点击连接并允许")
        }

        val builder = Builder()
            .setSession("SuperVPN")
            .setMtu(options.getMTU().coerceIn(1280, 9000))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            builder.setMetered(false)
        }
        runCatching { builder.setUnderlyingNetworks(null) }

        var hasInet4Address = false
        options.getInet4Address()?.let { iter ->
            while (iter.hasNext()) {
                val p = iter.next()
                val addr = p.address()
                if (!addr.isNullOrEmpty()) {
                    builder.addAddress(addr, p.prefix())
                    hasInet4Address = true
                }
            }
        }
        var hasInet6Address = false
        options.getInet6Address()?.let { iter ->
            while (iter.hasNext()) {
                val p = iter.next()
                val addr = p.address()
                if (!addr.isNullOrEmpty()) {
                    builder.addAddress(addr, p.prefix())
                    hasInet6Address = true
                }
            }
        }

        val dns = runCatching { options.getDNSServerAddress()?.value }.getOrNull()?.takeIf { it.isNotBlank() } ?: "172.19.0.2"
        runCatching { builder.addDnsServer(dns) }

        if (options.getAutoRoute()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val v4Routes = options.getInet4RouteAddress()
                if (v4Routes != null && v4Routes.hasNext()) {
                    addPrefixes({ addr, prefix -> builder.addRoute(IpPrefix(InetAddress.getByName(addr), prefix)) }, v4Routes)
                } else if (hasInet4Address) {
                    builder.addRoute("0.0.0.0", 0)
                }

                val v6Routes = options.getInet6RouteAddress()
                if (v6Routes != null && v6Routes.hasNext()) {
                    addPrefixes({ addr, prefix -> builder.addRoute(IpPrefix(InetAddress.getByName(addr), prefix)) }, v6Routes)
                } else if (hasInet6Address) {
                    builder.addRoute("::", 0)
                }

                addPrefixes(
                    { addr, prefix -> builder.excludeRoute(IpPrefix(InetAddress.getByName(addr), prefix)) },
                    options.getInet4RouteExcludeAddress(),
                )
                addPrefixes(
                    { addr, prefix -> builder.excludeRoute(IpPrefix(InetAddress.getByName(addr), prefix)) },
                    options.getInet6RouteExcludeAddress(),
                )
            } else {
                val v4Range = options.getInet4RouteRange()
                if (v4Range != null && v4Range.hasNext()) {
                    addPrefixes(builder::addRoute, v4Range)
                } else if (hasInet4Address) {
                    builder.addRoute("0.0.0.0", 0)
                }

                val v6Range = options.getInet6RouteRange()
                if (v6Range != null && v6Range.hasNext()) {
                    addPrefixes(builder::addRoute, v6Range)
                } else if (hasInet6Address) {
                    builder.addRoute("::", 0)
                }
            }
        }

        // Per-app split tunneling
        val settings = Runtime.data.settings
        when (settings.perAppMode) {
            "only" -> {
                val allowed = settings.perAppPackages.filter { it != packageName }
                if (allowed.isNotEmpty()) {
                    allowed.forEach { pkg -> runCatching { builder.addAllowedApplication(pkg) } }
                } else {
                    runCatching { builder.addDisallowedApplication(packageName) }
                }
            }
            "bypass" -> {
                runCatching { builder.addDisallowedApplication(packageName) }
                settings.perAppPackages.forEach { pkg ->
                    if (pkg != packageName) runCatching { builder.addDisallowedApplication(pkg) }
                }
            }
            else -> {
                runCatching { builder.addDisallowedApplication(packageName) }
            }
        }

        val established = builder.establish() ?: throw IllegalStateException("系统拒绝建立 VPN 隧道")
        synchronized(locker) {
            runCatching { tunnel?.close() }
            tunnel = established
        }
        return established.fd
    }

    private fun addPrefixes(
        target: (String, Int) -> Unit,
        iterator: RoutePrefixIterator?,
    ) {
        if (iterator == null) return
        while (iterator.hasNext()) {
            val prefix = iterator.next()
            val address = prefix.address()
            if (address.isNullOrEmpty()) continue
            runCatching { target(address, prefix.prefix()) }
        }
    }

    private fun closeTunnel() {
        synchronized(locker) {
            runCatching { tunnel?.close() }
            tunnel = null
        }
    }

    override fun onRevoke() {
        disconnect("VPN 授权已被系统撤销")
        super.onRevoke()
    }

    override fun onDestroy() {
        trafficRunning.set(false)
        val current = synchronized(locker) {
            val value = service
            service = null
            value
        }
        runCatching { current?.close() }
        closeTunnel()
        Runtime.updateConnectionState(isConnected = false, isBusy = false, statusText = "未连接", error = null)
        super.onDestroy()
    }

    private fun ensureChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(CHANNEL_ID, "VPN 状态", NotificationManager.IMPORTANCE_LOW)
        channel.setShowBadge(false)
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        ensureChannel()
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, SuperVpnService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val builder = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("SuperVPN")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "断开", stop).build())
        return builder.build()
    }

    private fun startForegroundNotification(text: String) {
        val notification = buildNotification(text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        const val ACTION_START = "app.supervpn.android.action.START"
        const val ACTION_STOP = "app.supervpn.android.action.STOP"
        const val EXTRA_CONFIG = "config"
        const val EXTRA_NODE_ID = "node_id"
        const val EXTRA_NODE_NAME = "node_name"
        private const val CHANNEL_ID = "supervpn-status"
        private const val NOTIFICATION_ID = 1001
        private val libboxInitialized = AtomicBoolean(false)
    }
}
