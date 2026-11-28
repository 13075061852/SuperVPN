package app.supervpn.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.supervpn.android.data.NodePresentation
import app.supervpn.android.data.Runtime

enum class ToolDestination {
    Menu,
    SpeedTest,
    WebsiteRules,
    AccessControl,
    Logs,
    NetworkSettings,
}

@Composable
fun ToolsScreen(
    destination: ToolDestination,
    onNavigate: (ToolDestination) -> Unit,
    onSwitchConnectedNode: () -> Unit,
) {
    BackHandler(enabled = destination != ToolDestination.Menu) {
        onNavigate(ToolDestination.Menu)
    }

    when (destination) {
        ToolDestination.Menu -> ToolsMenuContent(onNavigate = onNavigate)
        ToolDestination.SpeedTest -> SpeedTestScreen(
            onBack = { onNavigate(ToolDestination.Menu) },
            onSwitchConnectedNode = onSwitchConnectedNode,
        )
        ToolDestination.WebsiteRules -> RoutingScreen(
            initialTab = "websites",
            onBack = { onNavigate(ToolDestination.Menu) },
        )
        ToolDestination.AccessControl -> RoutingScreen(
            initialTab = "apps",
            onBack = { onNavigate(ToolDestination.Menu) },
        )
        ToolDestination.Logs -> SettingsLogsScreen(
            initialTab = "logs",
            onBack = { onNavigate(ToolDestination.Menu) },
        )
        ToolDestination.NetworkSettings -> SettingsLogsScreen(
            initialTab = "settings",
            onBack = { onNavigate(ToolDestination.Menu) },
        )
    }
}

@Composable
private fun ToolsMenuContent(
    onNavigate: (ToolDestination) -> Unit,
) {
    val data = Runtime.data
    val settings = data.settings
    var showThemeDialog by remember { mutableStateOf(false) }
    var showAboutDialog by remember { mutableStateOf(false) }

    val themeLabel = when (settings.themeMode) {
        "dark" -> "深色模式"
        "light" -> "浅色模式"
        else -> "跟随系统"
    }
    val accessLabel = when (settings.perAppMode) {
        "bypass" -> "绕过 ${settings.perAppPackages.size} 个应用"
        "only" -> "仅代理 ${settings.perAppPackages.size} 个应用"
        else -> "全部应用走代理"
    }
    val speedSubtitle = Runtime.lastSpeedTest?.let { last ->
        if (last.error != null) last.error
        else "上次：${NodePresentation.formatMbps(last.averageBytesPerSec)} · 延迟 ${last.latencyMs ?: -1} ms"
    } ?: "测试当前线路真连接延迟与下载带宽"

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 12.dp, bottom = 24.dp),
    ) {
        item {
            Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 2.dp)) {
                PageTopBar(title = "工具")
            }
        }

        item { ToolSectionHeader("测速与诊断") }
        item {
            ToolMenuRow(
                icon = AppIcons.Gauge,
                title = "网络测速",
                subtitle = speedSubtitle,
                badge = "测速",
                onClick = { onNavigate(ToolDestination.SpeedTest) },
            )
            ToolMenuRow(
                icon = AppIcons.Terminal,
                title = "运行日志",
                subtitle = "查看 sing-box 内核运行记录与排障信息",
                badge = "${Runtime.logs.size}",
                showDivider = false,
                onClick = { onNavigate(ToolDestination.Logs) },
            )
        }

        item { ToolSectionHeader("分流与访问控制") }
        item {
            ToolMenuRow(
                icon = AppIcons.Routing,
                title = "网站分流规则",
                subtitle = "管理直连、代理与拦截域名（含国内直连预设）",
                badge = "${data.websiteRules.count { it.enabled }} 条",
                onClick = { onNavigate(ToolDestination.WebsiteRules) },
            )
            ToolMenuRow(
                icon = AppIcons.Apps,
                title = "访问控制",
                subtitle = "配置应用分流策略：$accessLabel",
                showDivider = false,
                onClick = { onNavigate(ToolDestination.AccessControl) },
            )
        }

        item { ToolSectionHeader("设置") }
        item {
            ToolMenuRow(
                icon = AppIcons.Palette,
                title = "主题外观",
                subtitle = "当前：$themeLabel · SuperVPN 紫色主题",
                onClick = { showThemeDialog = true },
            )
            ToolMenuRow(
                icon = AppIcons.Settings,
                title = "内核与网络设置",
                subtitle = "默认路由动作、局域网直连、IPv6 双栈与证书策略",
                onClick = { onNavigate(ToolDestination.NetworkSettings) },
            )
            ToolMenuRow(
                icon = AppIcons.Info,
                title = "关于 SuperVPN",
                subtitle = "版本 0.2.5 · sing-box v1.12.14 · Keystore 加密存储",
                showDivider = false,
                onClick = { showAboutDialog = true },
            )
        }
    }

    if (showThemeDialog) {
        AlertDialog(
            onDismissRequest = { showThemeDialog = false },
            shape = RoundedCornerShape(CardRadius),
            title = { Text("主题外观", fontWeight = FontWeight.SemiBold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf(
                        "system" to "跟随系统",
                        "dark" to "深色模式（暗夜紫）",
                        "light" to "浅色模式（凝雾紫）",
                    ).forEach { (mode, label) ->
                        val selected = settings.themeMode == mode
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    Runtime.setThemeMode(mode)
                                    showThemeDialog = false
                                }
                                .padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(
                                selected = selected,
                                onClick = {
                                    Runtime.setThemeMode(mode)
                                    showThemeDialog = false
                                },
                                colors = RadioButtonDefaults.colors(selectedColor = MaterialTheme.colorScheme.primary),
                            )
                            Text(label, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showThemeDialog = false }) { Text("关闭") }
            },
        )
    }

    if (showAboutDialog) {
        AlertDialog(
            onDismissRequest = { showAboutDialog = false },
            shape = RoundedCornerShape(CardRadius),
            title = { Text("关于 SuperVPN Android", fontWeight = FontWeight.SemiBold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    AboutLine("应用版本", "0.2.5")
                    AboutLine("代理内核", "sing-box v1.12.14 (libbox)")
                    AboutLine("接管方式", "Android VpnService (TUN)")
                    AboutLine("本地存储", "Android Keystore AES-256-GCM")
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "所有节点凭据与订阅地址仅加密保存在本机应用私有目录，不会明文导出。",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        lineHeight = 16.sp,
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { showAboutDialog = false }) { Text("确定") }
            },
        )
    }
}

@Composable
private fun AboutLine(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}
