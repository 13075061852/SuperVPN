package app.supervpn.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.supervpn.android.data.LatencyResult
import app.supervpn.android.data.LatencyTester
import app.supervpn.android.data.NodePresentation
import app.supervpn.android.data.Runtime
import app.supervpn.android.data.SpeedTestProgress
import app.supervpn.android.data.SpeedTester
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

@Composable
fun SpeedTestScreen(
    onBack: () -> Unit,
    onSwitchConnectedNode: () -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    val ext = LocalSuperVpnColors.current
    val data = Runtime.data
    val activeNode = Runtime.activeNode()
    val useProxy = Runtime.connected && data.settings.outboundMode != "direct"

    var targetBytes by remember { mutableLongStateOf(10L * 1024L * 1024L) }
    var running by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf<SpeedTestProgress?>(null) }
    var activeJob by remember { mutableStateOf<Job?>(null) }

    DisposableEffect(Unit) {
        onDispose { activeJob?.cancel() }
    }

    val lastResult = Runtime.lastSpeedTest
    val displayCurrentBps = if (running) (progress?.currentBytesPerSec ?: 0L) else (lastResult?.averageBytesPerSec ?: 0L)
    val displayAvgBps = if (running) (progress?.averageBytesPerSec ?: 0L) else (lastResult?.averageBytesPerSec ?: 0L)
    val displayPeakBps = if (running) (progress?.peakBytesPerSec ?: 0L) else (lastResult?.peakBytesPerSec ?: 0L)
    val displayLatency = if (running) progress?.latencyMs else lastResult?.latencyMs
    val displayJitter = if (running) progress?.jitterMs else lastResult?.jitterMs
    val displayDownloaded = if (running) (progress?.downloadedBytes ?: 0L) else (lastResult?.downloadedBytes ?: 0L)
    val displayPoints = if (running) (progress?.speedPoints ?: emptyList()) else (lastResult?.speedPoints ?: emptyList())

    val rankedNodes = remember(data.nodes, Runtime.latencies.toMap()) {
        data.nodes
            .mapNotNull { node ->
                val lat = Runtime.latencies[node.id]
                if (lat?.status == "ok" && lat.delayMs != null) node to lat.delayMs else null
            }
            .sortedBy { it.second }
            .take(8)
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(SectionGap),
    ) {
        item {
            PageTopBar(
                title = "网络测速",
                badge = if (useProxy) "代理线路" else "直连网络",
                onBack = onBack,
            )
        }

        if (!useProxy) {
            item {
                OutlinedCardBox(
                    containerColor = ext.warningContainer,
                    borderColor = ext.warning.copy(alpha = 0.35f),
                    contentPadding = 11,
                ) {
                    Text(
                        text = if (!Runtime.connected) {
                            "当前未连接代理，测速将测量本机直连网络。连接代理后会自动经由当前节点测量真实带宽。"
                        } else {
                            "当前处于「直连」出站模式，测速将直接访问测试节点。"
                        },
                        fontSize = 11.sp,
                        color = ext.warning,
                        lineHeight = 16.sp,
                    )
                }
            }
        }

        // Main Speedometer & Live Throughput Curve Card
        item {
            OutlinedCardBox(contentPadding = 16) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = when {
                                running && progress?.phase == "latency" -> "正在测量真连接延迟…"
                                running -> "正在下载测速数据包…"
                                lastResult?.error != null -> lastResult.error
                                lastResult != null -> "测速完成 · ${NodePresentation.formatRelativeTime(lastResult.timestamp)}"
                                else -> "准备就绪"
                            },
                            fontSize = 12.sp,
                            color = if (lastResult?.error != null && !running) ext.danger else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = NodePresentation.formatMbps(displayCurrentBps),
                            fontSize = 30.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            text = "${NodePresentation.formatSpeed(displayCurrentBps)}  ·  ${activeNode?.name ?: "未选节点"}",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Box(
                        modifier = Modifier
                            .size(46.dp)
                            .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(CardRadius)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            AppIcons.Gauge,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(24.dp),
                        )
                    }
                }

                Spacer(Modifier.height(12.dp))
                SpeedCurveCanvas(
                    points = displayPoints,
                    lineColor = ext.downloadAccent,
                    guideColor = MaterialTheme.colorScheme.outline,
                    modifier = Modifier.fillMaxWidth().height(90.dp),
                )

                if (running) {
                    Spacer(Modifier.height(10.dp))
                    LinearProgressIndicator(
                        progress = { (progress?.progress ?: 0.05f).coerceIn(0f, 1f) },
                        modifier = Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(3.dp)),
                        color = Purple,
                        trackColor = MaterialTheme.colorScheme.surfaceVariant,
                    )
                }

                Spacer(Modifier.height(12.dp))
                // Test size presets
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    listOf(
                        5L * 1024L * 1024L to "轻量 5 MB",
                        10L * 1024L * 1024L to "标准 10 MB",
                        25L * 1024L * 1024L to "深度 25 MB",
                    ).forEach { (bytes, label) ->
                        FilterChip(
                            selected = targetBytes == bytes,
                            onClick = { if (!running) targetBytes = bytes },
                            enabled = !running,
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

                Spacer(Modifier.height(10.dp))
                Button(
                    onClick = {
                        if (running) {
                            activeJob?.cancel()
                            activeJob = null
                            running = false
                        } else {
                            running = true
                            progress = SpeedTestProgress(phase = "latency", progress = 0.05f, totalTargetBytes = targetBytes)
                            activeJob = scope.launch {
                                try {
                                    val result = SpeedTester.runDownloadTest(
                                        useProxy = useProxy,
                                        nodeName = activeNode?.name,
                                        targetBytes = targetBytes,
                                        onProgress = { p -> progress = p },
                                    )
                                    Runtime.lastSpeedTest = result
                                    if (result.error == null) {
                                        if (useProxy && Runtime.connectedNodeId != null && result.latencyMs != null) {
                                            Runtime.latencies[Runtime.connectedNodeId!!] = LatencyResult(
                                                status = "ok",
                                                delayMs = result.latencyMs,
                                                isRealProxy = true,
                                            )
                                        }
                                        Runtime.appendLog(
                                            "网络测速完成（${if (useProxy) "代理" else "直连"}）：平均 ${NodePresentation.formatMbps(result.averageBytesPerSec)}，峰值 ${NodePresentation.formatMbps(result.peakBytesPerSec)}，延迟 ${result.latencyMs ?: -1} ms"
                                        )
                                    } else {
                                        Runtime.appendLog("网络测速异常：${result.error}", level = "warn")
                                    }
                                } finally {
                                    running = false
                                    activeJob = null
                                }
                            }
                        }
                    },
                    shape = RoundedCornerShape(CardRadius),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (running) Danger else Purple,
                        contentColor = Color.White,
                    ),
                    modifier = Modifier.fillMaxWidth().height(44.dp),
                ) {
                    Icon(
                        if (running) AppIcons.Stop else AppIcons.Play,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(if (running) "停止测速" else "开始真实测速", fontWeight = FontWeight.Medium)
                }
            }
        }

        // 2x2 Metrics Grid
        item {
            Column(verticalArrangement = Arrangement.spacedBy(SectionGap)) {
                Row(horizontalArrangement = Arrangement.spacedBy(SectionGap), modifier = Modifier.fillMaxWidth()) {
                    MetricBox(
                        title = "真连接延迟",
                        value = displayLatency?.let { "$it ms" } ?: "--",
                        subtitle = if (useProxy) "HTTP 204 代理往返" else "HTTP 204 直连往返",
                        accent = displayLatency?.let {
                            when (NodePresentation.latencyTier(it)) {
                                "good" -> ext.success
                                "medium" -> ext.warning
                                else -> ext.danger
                            }
                        } ?: MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f),
                    )
                    MetricBox(
                        title = "网络抖动",
                        value = displayJitter?.let { "$it ms" } ?: "--",
                        subtitle = "连续三次采样波动",
                        accent = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(SectionGap), modifier = Modifier.fillMaxWidth()) {
                    MetricBox(
                        title = "平均 / 峰值",
                        value = if (displayAvgBps > 0L) NodePresentation.formatMbps(displayAvgBps) else "--",
                        subtitle = if (displayPeakBps > 0L) "峰值 ${NodePresentation.formatMbps(displayPeakBps)}" else "等待下载采样",
                        accent = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.weight(1f),
                    )
                    MetricBox(
                        title = "已传输数据",
                        value = if (displayDownloaded > 0L) NodePresentation.formatBytes(displayDownloaded) else "--",
                        subtitle = "目标 ${NodePresentation.formatBytes(targetBytes)}",
                        accent = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        // Node Latency Leaderboard Section
        item {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("节点延迟排行", style = MaterialTheme.typography.titleMedium)
                OutlinedButton(
                    onClick = {
                        if (Runtime.testingAll || data.nodes.isEmpty()) return@OutlinedButton
                        scope.launch {
                            Runtime.testingAll = true
                            try {
                                LatencyTester.measureBatch(
                                    nodes = data.nodes,
                                    onStart = { id -> Runtime.latencies[id] = LatencyResult("testing") },
                                    onResult = { id, res -> Runtime.latencies[id] = res },
                                )
                            } finally {
                                Runtime.testingAll = false
                            }
                        }
                    },
                    enabled = !Runtime.testingAll && data.nodes.isNotEmpty(),
                    shape = RoundedCornerShape(CardRadius),
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                ) {
                    Icon(AppIcons.Speed, contentDescription = null, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(if (Runtime.testingAll) "检测中…" else "批量测延迟", fontSize = 12.sp)
                }
            }
        }

        if (rankedNodes.isEmpty()) {
            item {
                OutlinedCardBox(contentPadding = 16) {
                    Text(
                        text = if (data.nodes.isEmpty()) "请先在「配置」页面导入节点或订阅" else "点击右上角「批量测延迟」查看最快的可用节点",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            items(rankedNodes, key = { it.first.id }) { (node, delayMs) ->
                val selected = node.id == data.settings.selectedNodeId
                val tierColor = when (NodePresentation.latencyTier(delayMs)) {
                    "good" -> ext.success
                    "medium" -> ext.warning
                    else -> ext.danger
                }
                OutlinedCardBox(
                    modifier = Modifier.clickable {
                        val changed = node.id != data.settings.selectedNodeId
                        Runtime.selectNode(node.id)
                        if (Runtime.connected && changed) onSwitchConnectedNode()
                    },
                    containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
                    borderColor = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                    contentPadding = 11,
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.weight(1f),
                        ) {
                            BadgePill(NodePresentation.regionCode(node.name))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    node.name,
                                    fontSize = 13.sp,
                                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(node.protocol, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "$delayMs ms",
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.SemiBold,
                            color = tierColor,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MetricBox(
    title: String,
    value: String,
    subtitle: String,
    accent: Color,
    modifier: Modifier = Modifier,
) {
    OutlinedCardBox(modifier = modifier, contentPadding = 12) {
        Text(title, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(4.dp))
        Text(
            value,
            fontSize = 16.sp,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.SemiBold,
            color = accent,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(2.dp))
        Text(subtitle, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun SpeedCurveCanvas(
    points: List<Long>,
    lineColor: Color,
    guideColor: Color,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        if (!w.isFinite() || !h.isFinite() || w <= 1f || h <= 1f) return@Canvas

        listOf(0.2f, 0.58f, 0.94f).forEach { frac ->
            drawLine(
                color = guideColor.copy(alpha = 0.45f),
                start = Offset(0f, h * frac),
                end = Offset(w, h * frac),
                strokeWidth = 1f,
            )
        }

        val data = if (points.size >= 2) points else listOf(0L, 0L)
        val maxVal = data.maxOrNull()?.coerceAtLeast(100_000L)?.toFloat() ?: 100_000f
        val stepX = w / (data.size - 1).coerceAtLeast(1)

        val strokePath = Path()
        val fillPath = Path()
        data.forEachIndexed { i, value ->
            val x = i * stepX
            val y = h * 0.94f - (value / maxVal) * (h * 0.78f)
            if (i == 0) {
                strokePath.moveTo(x, y)
                fillPath.moveTo(x, h * 0.94f)
                fillPath.lineTo(x, y)
            } else {
                strokePath.lineTo(x, y)
                fillPath.lineTo(x, y)
            }
        }
        fillPath.lineTo(w, h * 0.94f)
        fillPath.close()

        drawPath(
            path = fillPath,
            brush = Brush.verticalGradient(listOf(lineColor.copy(alpha = 0.30f), lineColor.copy(alpha = 0.02f))),
        )
        drawPath(
            path = strokePath,
            color = lineColor,
            style = Stroke(width = 3.5f, cap = StrokeCap.Round),
        )
    }
}
