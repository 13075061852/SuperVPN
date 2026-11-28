package app.supervpn.android.data

import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class LogEntry(
    val time: Long,
    val level: String, // "info" | "warn" | "error"
    val message: String,
) {
    fun formattedTime(): String = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date(time))
}

/** Observable UI state shared between the Compose UI and the VPN service. */
object Runtime {
    private val mainHandler by lazy {
        runCatching { Looper.getMainLooper()?.let { Handler(it) } }.getOrNull()
    }

    var data by mutableStateOf(AppData())
        private set
    var connected by mutableStateOf(false)
    var busy by mutableStateOf(false)
    var status by mutableStateOf("未连接")
    var lastError by mutableStateOf<String?>(null)
    var connectedNodeId by mutableStateOf<String?>(null)
    var connectedNodeName by mutableStateOf<String?>(null)
    var connectedSince by mutableLongStateOf(0L)
    var reconnectRequired by mutableStateOf(false)

    // Real-time traffic telemetry from Clash API
    var upSpeed by mutableLongStateOf(0L)
    var downSpeed by mutableLongStateOf(0L)
    var totalUp by mutableLongStateOf(0L)
    var totalDown by mutableLongStateOf(0L)
    val speedHistory = mutableStateListOf<TrafficSample>()

    // Latency measurements in memory (keyed by node id)
    val latencies = mutableStateMapOf<String, LatencyResult>()
    var testingAll by mutableStateOf(false)

    // Latest real bandwidth speed test result
    var lastSpeedTest by mutableStateOf<SpeedTestResult?>(null)

    val logs = mutableStateListOf<LogEntry>()

    private var store: Store? = null

    private fun onMain(block: () -> Unit) {
        val handler = mainHandler
        if (handler == null || Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            handler.post(block)
        }
    }

    fun attach(store: Store) {
        this.store = store
        val loaded = runCatching { store.load() }.getOrDefault(AppData())
        val migrated = DefaultWebsiteRules.seedIfNeeded(loaded)
        data = migrated
        if (migrated !== loaded) {
            Thread({ runCatching { store.save(migrated) } }, "supervpn-migrate").start()
        }
        if (speedHistory.isEmpty()) {
            repeat(30) { speedHistory.add(TrafficSample()) }
        }
        if (logs.isEmpty()) {
            appendLog("SuperVPN 已启动，节点与订阅保存在本机加密存储中")
        }
    }

    fun appendLog(message: String, level: String? = null) {
        val cleaned = message.trim().take(400)
        if (cleaned.isEmpty()) return
        val resolvedLevel = level ?: when {
            cleaned.contains("失败") || cleaned.contains("error", ignoreCase = true) || cleaned.contains("fatal", ignoreCase = true) -> "error"
            cleaned.contains("warn", ignoreCase = true) || cleaned.contains("撤销") -> "warn"
            else -> "info"
        }
        onMain {
            logs.add(LogEntry(System.currentTimeMillis(), resolvedLevel, cleaned))
            if (logs.size > 300) logs.removeRange(0, logs.size - 300)
        }
    }

    fun clearLogs() {
        onMain { logs.clear() }
    }

    fun updateConnectionState(
        isConnected: Boolean,
        isBusy: Boolean = false,
        statusText: String,
        error: String? = null,
        nodeId: String? = null,
        nodeName: String? = null,
    ) {
        onMain {
            connected = isConnected
            busy = isBusy
            status = statusText
            lastError = error
            if (isConnected) {
                connectedNodeId = nodeId ?: selectedNode()?.id
                connectedNodeName = nodeName ?: selectedNode()?.name
                if (connectedSince == 0L) connectedSince = System.currentTimeMillis()
                reconnectRequired = false
            } else if (!isBusy) {
                connectedNodeId = null
                connectedNodeName = null
                connectedSince = 0L
                upSpeed = 0L
                downSpeed = 0L
                totalUp = 0L
                totalDown = 0L
                reconnectRequired = false
                speedHistory.clear()
                repeat(30) { speedHistory.add(TrafficSample()) }
            }
        }
    }

    fun recordTrafficSample(sample: TrafficSample) {
        onMain {
            upSpeed = sample.upBytesPerSec
            downSpeed = sample.downBytesPerSec
            totalUp += sample.upBytesPerSec
            totalDown += sample.downBytesPerSec
            speedHistory.add(sample)
            if (speedHistory.size > 30) speedHistory.removeAt(0)
        }
    }

    private fun persist(next: AppData, marksReconnect: Boolean = false) {
        val previous = data
        data = next
        try {
            store?.save(next)
            if (marksReconnect && connected) reconnectRequired = true
        } catch (e: Exception) {
            data = previous
            lastError = "保存失败：${e.message ?: e.javaClass.simpleName}"
        }
    }

    fun selectNode(id: String) {
        persist(data.copy(settings = data.settings.copy(selectedNodeId = id)), marksReconnect = (connected && connectedNodeId != id))
        lastError = null
    }

    fun setOutboundMode(mode: String) {
        persist(data.copy(settings = data.settings.copy(outboundMode = mode)), marksReconnect = false)
    }

    fun setDefaultAction(action: String) {
        persist(data.copy(settings = data.settings.copy(defaultAction = action)), marksReconnect = true)
    }

    fun setBypassLan(enabled: Boolean) {
        persist(data.copy(settings = data.settings.copy(bypassLan = enabled)), marksReconnect = true)
    }

    fun setAllowInsecureNodes(allowed: Boolean) {
        persist(data.copy(settings = data.settings.copy(allowInsecureNodes = allowed)), marksReconnect = true)
    }

    fun setIpv6Enabled(enabled: Boolean) {
        persist(data.copy(settings = data.settings.copy(ipv6Enabled = enabled)), marksReconnect = true)
    }

    fun setThemeMode(mode: String) {
        val valid = mode.takeIf { it in setOf("system", "dark", "light") } ?: "system"
        persist(data.copy(settings = data.settings.copy(themeMode = valid)), marksReconnect = false)
    }

    fun setSortNodesByLatency(enabled: Boolean) {
        persist(data.copy(settings = data.settings.copy(sortNodesByLatency = enabled)), marksReconnect = false)
    }

    fun setHideUnavailableNodes(enabled: Boolean) {
        persist(data.copy(settings = data.settings.copy(hideUnavailableNodes = enabled)), marksReconnect = false)
    }

    fun setPerAppConfig(mode: String, packages: List<String>) {
        persist(
            data.copy(settings = data.settings.copy(perAppMode = mode, perAppPackages = packages.distinct().sorted())),
            marksReconnect = true,
        )
    }

    fun addNode(node: Node) {
        persist(data.copy(nodes = data.nodes + node, settings = data.settings.copy(selectedNodeId = node.id)))
    }

    fun addNodes(nodes: List<Node>) {
        if (nodes.isEmpty()) return
        val nextSelected = data.settings.selectedNodeId ?: nodes.first().id
        persist(data.copy(nodes = data.nodes + nodes, settings = data.settings.copy(selectedNodeId = nextSelected)))
    }

    fun renameNode(id: String, newName: String) {
        val trimmed = newName.trim().take(120)
        if (trimmed.isEmpty()) return
        val updated = data.nodes.map { if (it.id == id) it.copy(name = trimmed) else it }
        persist(data.copy(nodes = updated))
    }

    fun removeNode(id: String) {
        val remaining = data.nodes.filterNot { it.id == id }
        val selected = if (data.settings.selectedNodeId == id) remaining.firstOrNull()?.id else data.settings.selectedNodeId
        latencies.remove(id)
        persist(data.copy(nodes = remaining, settings = data.settings.copy(selectedNodeId = selected)))
    }

    fun applySubscription(subscription: Subscription, nodes: List<Node>) {
        val kept = data.nodes.filterNot { it.subscriptionId == subscription.id }
        val merged = kept + nodes
        val existing = data.subscriptions.filterNot { it.id == subscription.id } + subscription
        val selected = data.settings.selectedNodeId?.takeIf { id -> merged.any { it.id == id } }
            ?: merged.firstOrNull()?.id
        persist(data.copy(nodes = merged, subscriptions = existing, settings = data.settings.copy(selectedNodeId = selected)))
    }

    fun renameSubscription(id: String, newName: String) {
        val trimmed = newName.trim().take(80)
        if (trimmed.isEmpty()) return
        val updated = data.subscriptions.map { if (it.id == id) it.copy(name = trimmed) else it }
        persist(data.copy(subscriptions = updated))
    }

    fun removeSubscription(id: String) {
        val removedIds = data.nodes.filter { it.subscriptionId == id }.map { it.id }.toSet()
        removedIds.forEach { latencies.remove(it) }
        val remaining = data.nodes.filterNot { it.subscriptionId == id }
        val selected = data.settings.selectedNodeId?.takeIf { value -> remaining.any { it.id == value } }
            ?: remaining.firstOrNull()?.id
        persist(
            data.copy(
                nodes = remaining,
                subscriptions = data.subscriptions.filterNot { it.id == id },
                settings = data.settings.copy(selectedNodeId = selected),
            )
        )
    }

    fun addWebsiteRule(domainInput: String, action: String): String? {
        val domain = try {
            DefaultWebsiteRules.normalizeDomain(domainInput)
        } catch (e: Exception) {
            return e.message ?: "域名无效"
        }
        if (data.websiteRules.any { it.domain.equals(domain, ignoreCase = true) }) {
            return "该域名规则已存在"
        }
        if (data.websiteRules.size >= 1000) return "最多支持 1000 条网站规则"
        val rule = WebsiteRule(
            id = "custom:${System.currentTimeMillis()}:$domain",
            domain = domain,
            action = action.takeIf { it in setOf("proxy", "direct", "reject") } ?: "direct",
            enabled = true,
        )
        persist(data.copy(websiteRules = listOf(rule) + data.websiteRules), marksReconnect = true)
        return null
    }

    fun updateWebsiteRule(id: String, action: String? = null, enabled: Boolean? = null) {
        val updated = data.websiteRules.map { rule ->
            if (rule.id != id) rule
            else rule.copy(
                action = action ?: rule.action,
                enabled = enabled ?: rule.enabled,
            )
        }
        persist(data.copy(websiteRules = updated), marksReconnect = true)
    }

    fun removeWebsiteRule(id: String) {
        persist(data.copy(websiteRules = data.websiteRules.filterNot { it.id == id }), marksReconnect = true)
    }

    fun restoreDomesticPresets() {
        val restored = DefaultWebsiteRules.seedIfNeeded(data, force = true)
        persist(restored, marksReconnect = true)
    }

    fun selectedNode(): Node? = data.nodes.firstOrNull { it.id == data.settings.selectedNodeId } ?: data.nodes.firstOrNull()

    fun activeNode(): Node? =
        if (connected) data.nodes.firstOrNull { it.id == connectedNodeId } ?: selectedNode()
        else selectedNode()
}
