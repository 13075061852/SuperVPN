package app.supervpn.android.ui

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.supervpn.android.data.Runtime
import app.supervpn.android.data.WebsiteRule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private data class InstalledAppItem(
    val packageName: String,
    val label: String,
    val isSystem: Boolean,
)

@Composable
fun RoutingScreen(
    initialTab: String = "websites",
    onBack: (() -> Unit)? = null,
) {
    var activeSubTab by remember(initialTab) { mutableStateOf(initialTab) } // "websites" | "apps"
    val data = Runtime.data

    Column(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 6.dp)) {
            PageTopBar(
                title = if (activeSubTab == "websites") "网站分流规则" else "访问控制",
                badge = if (activeSubTab == "websites") "${data.websiteRules.count { it.enabled }} 条生效" else when (data.settings.perAppMode) {
                    "bypass" -> "绕过 ${data.settings.perAppPackages.size}"
                    "only" -> "仅代理 ${data.settings.perAppPackages.size}"
                    else -> "全部代理"
                },
                onBack = onBack,
            )
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                FilterChip(
                    selected = activeSubTab == "websites",
                    onClick = { activeSubTab = "websites" },
                    label = { Text("网站分流", fontSize = 12.sp) },
                    leadingIcon = { Icon(AppIcons.Globe, contentDescription = null, modifier = Modifier.size(15.dp)) },
                    shape = RoundedCornerShape(CardRadius),
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                        selectedLabelColor = MaterialTheme.colorScheme.primary,
                    ),
                    modifier = Modifier.weight(1f),
                )
                FilterChip(
                    selected = activeSubTab == "apps",
                    onClick = { activeSubTab = "apps" },
                    label = { Text("应用分流", fontSize = 12.sp) },
                    leadingIcon = { Icon(AppIcons.Apps, contentDescription = null, modifier = Modifier.size(15.dp)) },
                    shape = RoundedCornerShape(CardRadius),
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                        selectedLabelColor = MaterialTheme.colorScheme.primary,
                    ),
                    modifier = Modifier.weight(1f),
                )
            }
        }

        if (activeSubTab == "websites") {
            WebsiteRulesTab()
        } else {
            PerAppRoutingTab()
        }
    }
}

@Composable
private fun WebsiteRulesTab() {
    val data = Runtime.data
    var search by remember { mutableStateOf("") }
    var actionFilter by remember { mutableStateOf("all") } // "all" | "direct" | "proxy" | "reject"
    var showAddDialog by remember { mutableStateOf(false) }

    val filtered = remember(data.websiteRules, search, actionFilter) {
        data.websiteRules.filter { rule ->
            val matchFilter = actionFilter == "all" || rule.action == actionFilter
            val matchSearch = search.isBlank() || rule.domain.contains(search, ignoreCase = true)
            matchFilter && matchSearch
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = { showAddDialog = true },
                    shape = RoundedCornerShape(CardRadius),
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(AppIcons.Plus, contentDescription = null, modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("添加网站规则", fontSize = 12.sp)
                }
                OutlinedButton(
                    onClick = { Runtime.restoreDomesticPresets() },
                    shape = RoundedCornerShape(CardRadius),
                ) {
                    Text("恢复国内直连预设", fontSize = 12.sp)
                }
            }
        }

        item {
            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                placeholder = { Text("搜索域名（例如 bilibili.com）", fontSize = 12.sp) },
                leadingIcon = { Icon(AppIcons.Search, contentDescription = null, modifier = Modifier.size(16.dp)) },
                singleLine = true,
                shape = RoundedCornerShape(CardRadius),
                modifier = Modifier.fillMaxWidth(),
            )
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("all" to "全部", "direct" to "直连", "proxy" to "代理", "reject" to "拦截").forEach { (id, label) ->
                    FilterChip(
                        selected = actionFilter == id,
                        onClick = { actionFilter = id },
                        label = { Text(label, fontSize = 11.sp) },
                        shape = RoundedCornerShape(CardRadius),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                            selectedLabelColor = MaterialTheme.colorScheme.primary,
                        ),
                    )
                }
            }
        }

        if (filtered.isEmpty()) {
            item {
                EmptyStateCard(
                    icon = AppIcons.Routing,
                    title = "没有匹配的网站规则",
                    subtitle = "在规则模式下，网站分流规则优先于默认出站动作",
                )
            }
        } else {
            items(filtered, key = { it.id }) { rule ->
                WebsiteRuleCard(
                    rule = rule,
                    onCycleAction = {
                        val next = when (rule.action) {
                            "direct" -> "proxy"
                            "proxy" -> "reject"
                            else -> "direct"
                        }
                        Runtime.updateWebsiteRule(rule.id, action = next)
                    },
                    onToggle = { enabled -> Runtime.updateWebsiteRule(rule.id, enabled = enabled) },
                    onDelete = { Runtime.removeWebsiteRule(rule.id) },
                )
            }
        }
    }

    if (showAddDialog) {
        AddWebsiteRuleDialog(
            onDismiss = { showAddDialog = false },
            onAdd = { domain, action ->
                val err = Runtime.addWebsiteRule(domain, action)
                if (err == null) showAddDialog = false
                err
            },
        )
    }
}

@Composable
private fun WebsiteRuleCard(
    rule: WebsiteRule,
    onCycleAction: () -> Unit,
    onToggle: (Boolean) -> Unit,
    onDelete: () -> Unit,
) {
    val (actionLabel, bg, fg) = when (rule.action) {
        "proxy" -> Triple("代理", MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.primary)
        "reject" -> Triple("拦截", DangerSoft, Danger)
        else -> Triple("直连", SuccessSoft, Success)
    }
    OutlinedCardBox(contentPadding = 11) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                Text(
                    rule.domain,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = if (rule.enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(4.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.clickable { onCycleAction() },
                ) {
                    BadgePill(actionLabel, background = bg, contentColor = fg)
                    Text("点击切换动作", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Switch(checked = rule.enabled, onCheckedChange = onToggle)
            IconButton(onClick = onDelete, modifier = Modifier.size(30.dp)) {
                Icon(AppIcons.Trash, contentDescription = "删除规则", modifier = Modifier.size(15.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun AddWebsiteRuleDialog(
    onDismiss: () -> Unit,
    onAdd: (domain: String, action: String) -> String?,
) {
    var domain by remember { mutableStateOf("") }
    var action by remember { mutableStateOf("direct") }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(CardRadius),
        title = { Text("添加网站规则", fontWeight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = domain,
                    onValueChange = { domain = it; error = null },
                    label = { Text("域名或网址", fontSize = 12.sp) },
                    placeholder = { Text("例如 example.com", fontSize = 12.sp) },
                    singleLine = true,
                    shape = RoundedCornerShape(CardRadius),
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("direct" to "直连", "proxy" to "代理", "reject" to "拦截").forEach { (id, label) ->
                        FilterChip(
                            selected = action == id,
                            onClick = { action = id },
                            label = { Text(label, fontSize = 12.sp) },
                            shape = RoundedCornerShape(CardRadius),
                        )
                    }
                }
                error?.let { Text(it, color = Danger, fontSize = 12.sp) }
            }
        },
        confirmButton = {
            Button(
                onClick = { error = onAdd(domain, action) },
                enabled = domain.isNotBlank(),
                shape = RoundedCornerShape(CardRadius),
            ) { Text("添加") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun PerAppRoutingTab() {
    val context = LocalContext.current
    val settings = Runtime.data.settings
    var search by remember { mutableStateOf("") }
    var showSystemApps by remember { mutableStateOf(false) }
    var apps by remember { mutableStateOf<List<InstalledAppItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(Unit) {
        loading = true
        apps = withContext(Dispatchers.IO) {
            val pm = context.packageManager
            val selfPkg = context.packageName
            runCatching {
                val map = linkedMapOf<String, ApplicationInfo>()
                val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                pm.queryIntentActivities(launcherIntent, 0).forEach { resolve ->
                    val info = resolve.activityInfo?.applicationInfo ?: return@forEach
                    if (info.packageName != selfPkg) map[info.packageName] = info
                }
                runCatching {
                    pm.getInstalledApplications(0).forEach { info ->
                        if (info.packageName != selfPkg && !map.containsKey(info.packageName)) {
                            map[info.packageName] = info
                        }
                    }
                }
                map.values
                    .map { info ->
                        InstalledAppItem(
                            packageName = info.packageName,
                            label = runCatching { pm.getApplicationLabel(info).toString() }.getOrDefault(info.packageName),
                            isSystem = (info.flags and ApplicationInfo.FLAG_SYSTEM) != 0,
                        )
                    }
                    .sortedWith(compareBy<InstalledAppItem> { it.isSystem }.thenBy { it.label.lowercase() })
            }.getOrDefault(emptyList())
        }
        loading = false
    }

    val selectedSet = remember(settings.perAppPackages) { settings.perAppPackages.toSet() }
    val filteredApps = remember(apps, search, showSystemApps, selectedSet) {
        apps.filter { app ->
            val sysOk = showSystemApps || !app.isSystem || selectedSet.contains(app.packageName)
            val queryOk = search.isBlank() ||
                app.label.contains(search, ignoreCase = true) ||
                app.packageName.contains(search, ignoreCase = true)
            sysOk && queryOk
        }.sortedByDescending { selectedSet.contains(it.packageName) }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            OutlinedCardBox {
                Text("应用分流模式", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                    listOf("all" to "全部代理", "bypass" to "绕过选中", "only" to "仅代理选中").forEach { (mode, label) ->
                        FilterChip(
                            selected = settings.perAppMode == mode,
                            onClick = { Runtime.setPerAppConfig(mode, settings.perAppPackages) },
                            label = { Text(label, fontSize = 11.sp) },
                            shape = RoundedCornerShape(CardRadius),
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                                selectedLabelColor = MaterialTheme.colorScheme.primary,
                            ),
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
                Spacer(Modifier.height(6.dp))
                Text(
                    when (settings.perAppMode) {
                        "bypass" -> "下方勾选的应用将直接连接网络，不经过 VPN 隧道（重连生效）。"
                        "only" -> "仅下方勾选的应用流量经过 VPN 隧道，其余应用直连（重连生效）。"
                        else -> "除本应用自身外，设备上的全部应用流量均由 VPN 接管。"
                    },
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        if (settings.perAppMode != "all") {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = search,
                        onValueChange = { search = it },
                        placeholder = { Text("搜索应用名称或包名", fontSize = 12.sp) },
                        leadingIcon = { Icon(AppIcons.Search, contentDescription = null, modifier = Modifier.size(16.dp)) },
                        singleLine = true,
                        shape = RoundedCornerShape(CardRadius),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        FilterChip(
                            selected = showSystemApps,
                            onClick = { showSystemApps = !showSystemApps },
                            label = { Text("显示系统应用", fontSize = 11.sp) },
                            shape = RoundedCornerShape(CardRadius),
                        )
                        if (selectedSet.isNotEmpty()) {
                            TextButton(onClick = { Runtime.setPerAppConfig(settings.perAppMode, emptyList()) }) {
                                Text("清空已选 (${selectedSet.size})", fontSize = 12.sp, color = Danger)
                            }
                        }
                    }
                }
            }

            if (loading) {
                item {
                    OutlinedCardBox { Text("正在读取已安装应用列表…", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            } else {
                items(filteredApps, key = { it.packageName }) { app ->
                    val checked = selectedSet.contains(app.packageName)
                    OutlinedCardBox(
                        modifier = Modifier.clickable {
                            val next = if (checked) settings.perAppPackages - app.packageName else settings.perAppPackages + app.packageName
                            Runtime.setPerAppConfig(settings.perAppMode, next)
                        },
                        contentPadding = 10,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(
                                checked = checked,
                                onCheckedChange = { isChecked ->
                                    val next = if (isChecked) settings.perAppPackages + app.packageName else settings.perAppPackages - app.packageName
                                    Runtime.setPerAppConfig(settings.perAppMode, next)
                                },
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(app.label, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(app.packageName, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            if (app.isSystem) {
                                BadgePill("系统", background = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }
}
