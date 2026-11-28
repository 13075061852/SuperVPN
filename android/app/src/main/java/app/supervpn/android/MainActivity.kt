package app.supervpn.android

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import app.supervpn.android.data.ConfigBuilder
import app.supervpn.android.data.CrashGuard
import app.supervpn.android.data.LinkParser
import app.supervpn.android.data.Runtime
import app.supervpn.android.data.Subscription
import app.supervpn.android.data.SubscriptionFetcher
import app.supervpn.android.service.SuperVpnService
import app.supervpn.android.ui.AppIcons
import app.supervpn.android.ui.CardRadius
import app.supervpn.android.ui.DashboardScreen
import app.supervpn.android.ui.ImportSourceDialog
import app.supervpn.android.ui.LocalSuperVpnColors
import app.supervpn.android.ui.NodesScreen
import app.supervpn.android.ui.SubscriptionsScreen
import app.supervpn.android.ui.SuperVpnTheme
import app.supervpn.android.ui.ToolDestination
import app.supervpn.android.ui.ToolsScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.URI
import java.util.UUID

class MainActivity : ComponentActivity() {
    private var pendingStartAfterConsent = false

    private val consentLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK && pendingStartAfterConsent) {
            startTunnel()
        }
        pendingStartAfterConsent = false
    }

    private val notificationLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            val previousCrash = CrashGuard.read(this)
            setContent {
                SuperVpnTheme(themeMode = Runtime.data.settings.themeMode) {
                    Surface(modifier = Modifier.fillMaxSize()) {
                        SuperVpnApp(
                            initialCrashReport = previousCrash,
                            onConnect = { connect() },
                            onDisconnect = {
                                runCatching {
                                    startService(Intent(this, SuperVpnService::class.java).setAction(SuperVpnService.ACTION_STOP))
                                }.onFailure {
                                    stopService(Intent(this, SuperVpnService::class.java))
                                }
                            },
                            onReconnect = { connect() },
                        )
                    }
                }
            }
            window?.decorView?.post {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                ) {
                    runCatching { notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) }
                }
            }
        } catch (t: Throwable) {
            CrashGuard.record(this, "MainActivity.onCreate", t)
            showFallbackCrashView(t)
        }
    }

    private fun showFallbackCrashView(error: Throwable) {
        val scroll = ScrollView(this)
        val view = TextView(this).apply {
            setPadding(40, 64, 40, 64)
            textSize = 13f
            text = "SuperVPN 启动遇到异常：\n\n${error.javaClass.name}: ${error.message}\n\n" +
                error.stackTraceToString().take(4000)
        }
        scroll.addView(view)
        setContentView(scroll)
    }

    private fun connect() {
        val node = Runtime.selectedNode()
        if (node == null) {
            Runtime.lastError = "请先添加并选择节点"
            return
        }
        val prepared = VpnService.prepare(this)
        if (prepared != null) {
            pendingStartAfterConsent = true
            consentLauncher.launch(prepared)
            return
        }
        startTunnel()
    }

    private fun startTunnel() {
        val node = Runtime.selectedNode() ?: return
        val config = try {
            ConfigBuilder.build(Runtime.data, node)
        } catch (e: Exception) {
            Runtime.lastError = e.message ?: "配置生成失败"
            return
        }
        val intent = Intent(this, SuperVpnService::class.java)
            .setAction(SuperVpnService.ACTION_START)
            .putExtra(SuperVpnService.EXTRA_CONFIG, config)
            .putExtra(SuperVpnService.EXTRA_NODE_ID, node.id)
            .putExtra(SuperVpnService.EXTRA_NODE_NAME, node.name)
        ContextCompat.startForegroundService(this, intent)
    }
}

private enum class AppTab(val label: String) {
    Dashboard("仪表盘"),
    Proxies("代理"),
    Profiles("配置"),
    Tools("工具");

    fun iconVector(): ImageVector = when (this) {
        Dashboard -> AppIcons.DashboardGrid
        Proxies -> AppIcons.Nodes
        Profiles -> AppIcons.Subscriptions
        Tools -> AppIcons.Tools
    }
}

@Composable
internal fun SuperVpnApp(
    initialCrashReport: String?,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onReconnect: () -> Unit,
) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val ext = LocalSuperVpnColors.current

    var currentTab by remember { mutableStateOf(AppTab.Dashboard) }
    var toolDestination by remember { mutableStateOf(ToolDestination.Menu) }
    var proxyFilterGroupId by remember { mutableStateOf<String?>(null) }
    var showImportDialog by remember { mutableStateOf(false) }
    var importBusy by remember { mutableStateOf(false) }
    var importError by remember { mutableStateOf<String?>(null) }
    var crashReport by remember { mutableStateOf(initialCrashReport) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            Column {
                HorizontalDivider(thickness = 0.8.dp, color = ext.divider)
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    tonalElevation = 0.dp,
                ) {
                    AppTab.entries.forEach { tab ->
                        val selected = currentTab == tab
                        NavigationBarItem(
                            selected = selected,
                            onClick = {
                                if (tab == AppTab.Tools && currentTab == AppTab.Tools) {
                                    toolDestination = ToolDestination.Menu
                                } else if (tab == AppTab.Tools) {
                                    toolDestination = ToolDestination.Menu
                                }
                                currentTab = tab
                            },
                            icon = {
                                Icon(
                                    tab.iconVector(),
                                    contentDescription = tab.label,
                                    modifier = Modifier.size(20.dp),
                                )
                            },
                            label = { Text(tab.label, fontSize = 11.sp) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = MaterialTheme.colorScheme.primary,
                                selectedTextColor = MaterialTheme.colorScheme.primary,
                                indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                                unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            ),
                        )
                    }
                }
            }
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when (currentTab) {
                AppTab.Dashboard -> DashboardScreen(
                    onConnect = onConnect,
                    onDisconnect = onDisconnect,
                    onReconnect = onReconnect,
                    onOpenNodes = {
                        proxyFilterGroupId = null
                        currentTab = AppTab.Proxies
                    },
                    onOpenImport = { importError = null; showImportDialog = true },
                )
                AppTab.Proxies -> NodesScreen(
                    initialGroupId = proxyFilterGroupId,
                    onOpenImport = { importError = null; showImportDialog = true },
                    onSwitchConnectedNode = onReconnect,
                )
                AppTab.Profiles -> SubscriptionsScreen(
                    onOpenImport = { importError = null; showImportDialog = true },
                    onSelectSubscription = { subId ->
                        proxyFilterGroupId = subId
                        currentTab = AppTab.Proxies
                    },
                )
                AppTab.Tools -> ToolsScreen(
                    destination = toolDestination,
                    onNavigate = { toolDestination = it },
                    onSwitchConnectedNode = onReconnect,
                )
            }
        }
    }

    crashReport?.let { report ->
        AlertDialog(
            onDismissRequest = {
                CrashGuard.clear(context)
                crashReport = null
            },
            shape = RoundedCornerShape(CardRadius),
            title = { Text("上次运行检测到异常") },
            text = {
                Column(modifier = Modifier.fillMaxWidth().heightIn(max = 300.dp).verticalScroll(rememberScrollState())) {
                    Text(report, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    clipboard.setText(AnnotatedString(report))
                    CrashGuard.clear(context)
                    crashReport = null
                }) { Text("复制并关闭") }
            },
            dismissButton = {
                TextButton(onClick = {
                    CrashGuard.clear(context)
                    crashReport = null
                }) { Text("忽略") }
            },
        )
    }

    if (showImportDialog) {
        ImportSourceDialog(
            busy = importBusy,
            error = importError,
            onDismiss = { showImportDialog = false; importError = null },
            onConfirm = { customName, content ->
                importError = null
                if (SubscriptionFetcher.looksLikeSubscriptionUrl(content)) {
                    scope.launch {
                        importBusy = true
                        val result = withContext(Dispatchers.IO) {
                            runCatching {
                                val payload = SubscriptionFetcher.fetchWithMetadata(content)
                                val parsed = SubscriptionFetcher.parse(payload.body)
                                Triple(payload, parsed, runCatching { URI(content).host }.getOrNull())
                            }
                        }
                        importBusy = false
                        result.fold(
                            onSuccess = { (payload, parsed, host) ->
                                val id = UUID.randomUUID().toString()
                                val name = customName.ifEmpty { payload.suggestedName ?: host ?: "订阅" }
                                Runtime.applySubscription(
                                    Subscription(
                                        id = id,
                                        url = content,
                                        name = name,
                                        count = parsed.nodes.size,
                                        updatedAt = System.currentTimeMillis(),
                                        usage = payload.usage,
                                    ),
                                    parsed.nodes.map { it.copy(subscriptionId = id) },
                                )
                                Runtime.appendLog("订阅「$name」导入成功：${parsed.nodes.size} 个节点，跳过 ${parsed.skipped}")
                                showImportDialog = false
                                proxyFilterGroupId = id
                                currentTab = AppTab.Proxies
                            },
                            onFailure = { err ->
                                importError = err.message ?: "订阅导入失败"
                            },
                        )
                    }
                } else {
                    val lines = content.lineSequence().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }.toList()
                    if (lines.isEmpty()) {
                        importError = "请输入有效的订阅地址或节点链接"
                        return@ImportSourceDialog
                    }
                    val parsedNodes = mutableListOf<app.supervpn.android.data.Node>()
                    var firstError: String? = null
                    for (line in lines) {
                        runCatching { LinkParser.parse(line) }.fold(
                            onSuccess = { node ->
                                val named = if (lines.size == 1 && customName.isNotEmpty()) node.copy(name = customName) else node
                                parsedNodes += named
                            },
                            onFailure = { if (firstError == null) firstError = it.message },
                        )
                    }
                    if (parsedNodes.isEmpty()) {
                        importError = firstError ?: "节点链接格式无效"
                    } else {
                        if (parsedNodes.size == 1) Runtime.addNode(parsedNodes.first())
                        else Runtime.addNodes(parsedNodes)
                        Runtime.appendLog("已导入 ${parsedNodes.size} 个手动节点" + if (parsedNodes.size < lines.size) "（跳过 ${lines.size - parsedNodes.size} 条无效链接）" else "")
                        showImportDialog = false
                        proxyFilterGroupId = null
                        currentTab = AppTab.Proxies
                    }
                }
            },
        )
    }
}
