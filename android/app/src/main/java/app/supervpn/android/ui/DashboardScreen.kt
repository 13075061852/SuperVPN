package app.supervpn.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.supervpn.android.data.ClashApiClient
import app.supervpn.android.data.NetworkInfo
import app.supervpn.android.data.NetworkInspector
import app.supervpn.android.data.NodePresentation
import app.supervpn.android.data.Runtime
import app.supervpn.android.data.TrafficSample
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun DashboardScreen(
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onReconnect: () -> Unit,
    onOpenNodes: () -> Unit,
    onOpenImport: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val ext = LocalSuperVpnColors.current
    val data = Runtime.data
    val node = Runtime.activeNode()
    var nowMillis by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var networkInfo by remember { mutableStateOf<NetworkInfo?>(null) }
    var checkingNetwork by remember { mutableStateOf(false) }
    var refreshKey by remember { mutableIntStateOf(0) }
    var modeFeedback by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Runtime.connected, Runtime.connectedSince) {
        while (Runtime.connected && Runtime.connectedSince > 0L) {
            nowMillis = System.currentTimeMillis()
            delay(1000L)
        }
    }

    LaunchedEffect(Runtime.connected, Runtime.connectedNodeId, data.settings.outboundMode, refreshKey) {
        checkingNetwork = true
        val viaProxy = Runtime.connected && data.settings.outboundMode != "direct"
        if (viaProxy) delay(450L)
        val result = runCatching { NetworkInspector.inspect(useProxy = viaProxy) }
            .getOrElse { NetworkInfo(viaProxy = viaProxy, error = "检测失败，点击重试") }
        networkInfo = result
        checkingNetwork = false
    }

    val durationText = if (Runtime.connected && Runtime.connectedSince > 0L) {
        NodePresentation.formatDuration((nowMillis - Runtime.connectedSince) / 1000L)
    } else null

    Box(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 92.dp),
            verticalArrangement = Arrangement.spacedBy(SectionGap),
        ) {
            item {
                PageTopBar(
                    title = "仪表盘",
                    actions = {
                        // Connection Status Pill
                        val isConnected = Runtime.connected
                        Row(
                            modifier = Modifier
                                .background(
                                    color = if (isConnected) ext.successContainer else MaterialTheme.colorScheme.surfaceVariant,
                                    shape = RoundedCornerShape(CardRadius),
                                )
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(7.dp)
                                    .background(
                                        if (isConnected) ext.success else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                                        CircleShape,
                                    ),
                            )
                            Text(
                                text = if (isConnected && durationText != null) durationText else Runtime.status,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = if (isConnected) ext.success else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    },
                )
            }

            if (Runtime.connected && Runtime.reconnectRequired) {
                item {
                    OutlinedCardBox(
                        containerColor = ext.warningContainer,
                        borderColor = ext.warning.copy(alpha = 0.35f),
                        contentPadding = 10,
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(
                                "节点或配置已更改，重连后生效",
                                color = ext.warning,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.weight(1f),
                            )
                            TextButton(onClick = onReconnect, enabled = !Runtime.busy) {
                                Text("立即重连", fontSize = 12.sp, color = ext.warning, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
            }

            Runtime.lastError?.let { error ->
                item {
                    OutlinedCardBox(
                        containerColor = ext.dangerContainer,
                        borderColor = ext.danger.copy(alpha = 0.4f),
                        contentPadding = 10,
                    ) {
                        Text(error, color = ext.danger, fontSize = 12.sp)
                    }
                }
            }

            // Card 1: Full-width Network Speed Card + Active Node Strip
            item {
                OutlinedCardBox(contentPadding = 14) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            Icon(
                                AppIcons.Gauge,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(16.dp),
                            )
                            Text("网络速度", style = MaterialTheme.typography.titleSmall)
                        }
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text(
                                "↑ ${NodePresentation.formatSpeed(if (Runtime.connected) Runtime.upSpeed else 0L)}",
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace,
                                color = ext.uploadAccent,
                            )
                            Text(
                                "↓ ${NodePresentation.formatSpeed(if (Runtime.connected) Runtime.downSpeed else 0L)}",
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.SemiBold,
                                color = ext.downloadAccent,
                            )
                        }
                    }

                    Spacer(Modifier.height(10.dp))
                    SpeedSparkline(
                        samples = Runtime.speedHistory.toList(),
                        lineColor = ext.downloadAccent,
                        uploadColor = ext.uploadAccent,
                        guideColor = MaterialTheme.colorScheme.outline,
                        modifier = Modifier.fillMaxWidth().height(92.dp),
                    )

                    Spacer(Modifier.height(10.dp))
                    HorizontalDivider(thickness = 0.8.dp, color = ext.divider)
                    Spacer(Modifier.height(10.dp))

                    // Active node summary bar (SuperVPN signature touch)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { if (node != null) onOpenNodes() else onOpenImport() },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.weight(1f),
                        ) {
                            Box(
                                modifier = Modifier
                                    .background(
                                        if (Runtime.connected) Purple else MaterialTheme.colorScheme.primaryContainer,
                                        RoundedCornerShape(6.dp),
                                    )
                                    .padding(horizontal = 7.dp, vertical = 3.dp),
                            ) {
                                Text(
                                    text = node?.let { NodePresentation.regionCode(it.name) } ?: "--",
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (Runtime.connected) Color.White else MaterialTheme.colorScheme.primary,
                                )
                            }
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = node?.name ?: "尚未选择节点，点击导入",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Medium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                if (node != null) {
                                    val lat = Runtime.latencies[node.id]
                                    val subText = buildString {
                                        append(node.protocol)
                                        if (lat?.status == "ok" && lat.delayMs != null) {
                                            append(" · ")
                                            append("${lat.delayMs} ms")
                                        }
                                    }
                                    Text(
                                        subText,
                                        fontSize = 11.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                    )
                                }
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                if (node != null) "切换" else "导入",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Medium,
                                color = MaterialTheme.colorScheme.primary,
                            )
                            Icon(
                                AppIcons.ChevronRight,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(14.dp),
                            )
                        }
                    }
                }
            }

            // Row 2: 2-Column Asymmetric Bento Grid
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(SectionGap),
                    verticalAlignment = Alignment.Top,
                ) {
                    // Left Column: Outbound Mode + Local IP
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(SectionGap),
                    ) {
                        OutlinedCardBox(contentPadding = 13) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                                Icon(
                                    AppIcons.Routing,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(16.dp),
                                )
                                Text("出站模式", style = MaterialTheme.typography.titleSmall)
                            }
                            Spacer(Modifier.height(10.dp))
                            listOf("rule" to "规则", "global" to "全局", "direct" to "直连").forEach { (value, label) ->
                                val selected = data.settings.outboundMode == value
                                OutboundRadioRow(
                                    label = label,
                                    selected = selected,
                                    onClick = {
                                        Runtime.setOutboundMode(value)
                                        if (Runtime.connected) {
                                            scope.launch {
                                                val ok = withContext(Dispatchers.IO) { ClashApiClient.patchMode(value) }
                                                modeFeedback = if (ok) "已切换：$label" else "重连后生效"
                                                Runtime.appendLog("出站模式切换为 $label（${if (ok) "即时生效" else "下次连接生效"}）")
                                            }
                                        } else {
                                            modeFeedback = null
                                        }
                                    },
                                )
                            }
                            if (modeFeedback != null) {
                                Spacer(Modifier.height(4.dp))
                                Text(modeFeedback!!, fontSize = 10.sp, color = MaterialTheme.colorScheme.primary)
                            }
                        }

                        OutlinedCardBox(contentPadding = 13) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                                Icon(
                                    AppIcons.Device,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(15.dp),
                                )
                                Text("内网 IP", style = MaterialTheme.typography.titleSmall)
                            }
                            Spacer(Modifier.height(8.dp))
                            Text(
                                text = networkInfo?.localIps?.firstOrNull() ?: if (checkingNetwork) "检测中…" else "未发现",
                                fontSize = 14.sp,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.Medium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Spacer(Modifier.height(3.dp))
                            Text(
                                text = "规则 ${data.websiteRules.count { it.enabled }} · 节点 ${data.nodes.size}",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                            )
                        }
                    }

                    // Right Column: Network Check + Traffic Donut Stats
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(SectionGap),
                    ) {
                        OutlinedCardBox(
                            modifier = Modifier.clickable(enabled = !checkingNetwork) { refreshKey++ },
                            contentPadding = 13,
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Box(
                                        modifier = Modifier
                                            .background(
                                                if (networkInfo?.viaProxy == true) ext.successContainer else MaterialTheme.colorScheme.primaryContainer,
                                                RoundedCornerShape(5.dp),
                                            )
                                            .padding(horizontal = 5.dp, vertical = 2.dp),
                                    ) {
                                        Text(
                                            text = networkInfo?.countryCode ?: "--",
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = if (networkInfo?.viaProxy == true) ext.success else MaterialTheme.colorScheme.primary,
                                        )
                                    }
                                    Text("网络检测", style = MaterialTheme.typography.titleSmall)
                                }
                                Icon(
                                    AppIcons.Refresh,
                                    contentDescription = "刷新网络检测",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.size(14.dp),
                                )
                            }
                            Spacer(Modifier.height(8.dp))
                            Text(
                                text = when {
                                    checkingNetwork -> "检测中…"
                                    networkInfo?.publicIp != null -> networkInfo!!.publicIp!!
                                    else -> networkInfo?.error ?: "点击检测"
                                },
                                fontSize = 13.sp,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.Medium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Spacer(Modifier.height(2.dp))
                            Text(
                                text = networkInfo?.let { info ->
                                    val tag = if (info.viaProxy) "代理出口" else "直连出口"
                                    val country = info.country
                                    if (!country.isNullOrBlank()) "$tag · $country" else tag
                                } ?: "点击刷新出口状态",
                                fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }

                        OutlinedCardBox(contentPadding = 13) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                                Icon(
                                    AppIcons.Dashboard,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(15.dp),
                                )
                                Text("流量统计", style = MaterialTheme.typography.titleSmall)
                            }
                            Spacer(Modifier.height(10.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                TrafficDonutChart(
                                    uploadBytes = Runtime.totalUp,
                                    downloadBytes = Runtime.totalDown,
                                    uploadColor = ext.uploadAccent,
                                    downloadColor = ext.downloadAccent,
                                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                                    modifier = Modifier.size(62.dp),
                                )
                                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    LegendRow(color = ext.uploadAccent, label = "上传")
                                    LegendRow(color = ext.downloadAccent, label = "下载")
                                }
                            }
                            Spacer(Modifier.height(10.dp))
                            TrafficAmountLine("↑", NodePresentation.formatBytes(Runtime.totalUp), ext.uploadAccent)
                            Spacer(Modifier.height(3.dp))
                            TrafficAmountLine("↓", NodePresentation.formatBytes(Runtime.totalDown), ext.downloadAccent)
                        }
                    }
                }
            }
        }

        // Bottom-right Signature Floating Action Button (Play / Stop)
        val isConnected = Runtime.connected
        BrandFab(
            icon = if (isConnected) AppIcons.Stop else AppIcons.Play,
            contentDescription = if (isConnected) "断开连接" else "连接代理",
            loading = Runtime.busy,
            containerColor = if (isConnected) Danger else Purple,
            contentColor = Color.White,
            onClick = {
                if (isConnected) onDisconnect()
                else if (node == null) onOpenImport()
                else onConnect()
            },
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp),
        )
    }
}

@Composable
private fun OutboundRadioRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(18.dp)
                .border(
                    width = 1.8.dp,
                    color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                    shape = CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (selected) {
                Box(
                    modifier = Modifier
                        .size(9.dp)
                        .background(MaterialTheme.colorScheme.primary, CircleShape),
                )
            }
        }
        Text(
            text = label,
            fontSize = 13.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun LegendRow(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(
            modifier = Modifier
                .width(14.dp)
                .height(6.dp)
                .background(color, RoundedCornerShape(3.dp)),
        )
        Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun TrafficAmountLine(arrow: String, amount: String, color: Color) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(arrow, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = color)
        Text(
            amount,
            fontSize = 12.sp,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun TrafficDonutChart(
    uploadBytes: Long,
    downloadBytes: Long,
    uploadColor: Color,
    downloadColor: Color,
    trackColor: Color,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier) {
        val stroke = 9.dp.toPx()
        val inset = stroke / 2f
        val arcSize = Size(size.width - stroke, size.height - stroke)
        val topLeft = Offset(inset, inset)
        val total = (uploadBytes + downloadBytes).coerceAtLeast(0L)

        if (total == 0L) {
            // Subtle balanced idle ring
            drawArc(
                color = trackColor,
                startAngle = -90f,
                sweepAngle = 360f,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )
            drawArc(
                color = uploadColor.copy(alpha = 0.45f),
                startAngle = -80f,
                sweepAngle = 155f,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )
            drawArc(
                color = downloadColor.copy(alpha = 0.45f),
                startAngle = 100f,
                sweepAngle = 155f,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )
            return@Canvas
        }

        val gap = 14f
        val upFraction = (uploadBytes.toFloat() / total.toFloat()).coerceIn(0.05f, 0.95f)
        val upSweep = (360f - gap * 2f) * upFraction
        val downSweep = (360f - gap * 2f) * (1f - upFraction)

        drawArc(
            color = uploadColor,
            startAngle = -90f + gap / 2f,
            sweepAngle = upSweep,
            useCenter = false,
            topLeft = topLeft,
            size = arcSize,
            style = Stroke(width = stroke, cap = StrokeCap.Round),
        )
        drawArc(
            color = downloadColor,
            startAngle = -90f + gap / 2f + upSweep + gap,
            sweepAngle = downSweep,
            useCenter = false,
            topLeft = topLeft,
            size = arcSize,
            style = Stroke(width = stroke, cap = StrokeCap.Round),
        )
    }
}

@Composable
private fun SpeedSparkline(
    samples: List<TrafficSample>,
    lineColor: Color,
    uploadColor: Color,
    guideColor: Color,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        if (!w.isFinite() || !h.isFinite() || w <= 1f || h <= 1f) return@Canvas

        listOf(0.18f, 0.56f, 0.94f).forEach { frac ->
            drawLine(
                color = guideColor.copy(alpha = 0.45f),
                start = Offset(0f, h * frac),
                end = Offset(w, h * frac),
                strokeWidth = 1f,
            )
        }

        val points = if (samples.size >= 2) samples else listOf(TrafficSample(), TrafficSample())
        val maxVal = points.maxOf { maxOf(it.downBytesPerSec, it.upBytesPerSec) }.coerceAtLeast(1024L).toFloat()
        val stepX = w / (points.size - 1).coerceAtLeast(1)

        val downPath = Path()
        val fillPath = Path()
        val upPath = Path()

        points.forEachIndexed { idx, sample ->
            val x = idx * stepX
            val yDown = h * 0.94f - (sample.downBytesPerSec / maxVal) * (h * 0.78f)
            val yUp = h * 0.94f - (sample.upBytesPerSec / maxVal) * (h * 0.78f)
            if (idx == 0) {
                downPath.moveTo(x, yDown)
                fillPath.moveTo(x, h * 0.94f)
                fillPath.lineTo(x, yDown)
                upPath.moveTo(x, yUp)
            } else {
                downPath.lineTo(x, yDown)
                fillPath.lineTo(x, yDown)
                upPath.lineTo(x, yUp)
            }
        }
        fillPath.lineTo(w, h * 0.94f)
        fillPath.close()

        drawPath(
            path = fillPath,
            brush = Brush.verticalGradient(
                colors = listOf(lineColor.copy(alpha = 0.28f), lineColor.copy(alpha = 0.02f)),
            ),
        )
        drawPath(
            path = downPath,
            color = lineColor,
            style = Stroke(width = 3.5f, cap = StrokeCap.Round),
        )
        drawPath(
            path = upPath,
            color = uploadColor.copy(alpha = 0.85f),
            style = Stroke(
                width = 2.4f,
                cap = StrokeCap.Round,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 6f), 0f),
            ),
        )
    }
}
