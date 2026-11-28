package app.supervpn.android.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** Lightweight stroke vector icons aligned with desktop Lucide aesthetic (no emoji). */
object AppIcons {
    private fun strokeIcon(name: String, block: PathBuilder.() -> Unit): ImageVector =
        ImageVector.Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                fill = null,
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 1.9f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathFillType = PathFillType.NonZero,
                pathBuilder = block,
            )
        }.build()

    val Dashboard: ImageVector by lazy {
        strokeIcon("Dashboard") {
            moveTo(4f, 13f)
            arcTo(8f, 8f, 0f, isMoreThanHalf = true, isPositiveArc = true, 20f, 13f)
            moveTo(12f, 13f)
            lineTo(16f, 9f)
            moveTo(7f, 19f)
            lineTo(17f, 19f)
        }
    }

    val DashboardGrid: ImageVector by lazy {
        strokeIcon("DashboardGrid") {
            moveTo(4f, 4f); lineTo(10.5f, 4f); lineTo(10.5f, 12.5f); lineTo(4f, 12.5f); close()
            moveTo(13.5f, 4f); lineTo(20f, 4f); lineTo(20f, 9f); lineTo(13.5f, 9f); close()
            moveTo(13.5f, 12f); lineTo(20f, 12f); lineTo(20f, 20f); lineTo(13.5f, 20f); close()
            moveTo(4f, 15.5f); lineTo(10.5f, 15.5f); lineTo(10.5f, 20f); lineTo(4f, 20f); close()
        }
    }

    val Nodes: ImageVector by lazy {
        strokeIcon("Nodes") {
            moveTo(4f, 6f); lineTo(20f, 6f); lineTo(20f, 10f); lineTo(4f, 10f); close()
            moveTo(4f, 14f); lineTo(20f, 14f); lineTo(20f, 18f); lineTo(4f, 18f); close()
            moveTo(7f, 8f); lineTo(7.1f, 8f)
            moveTo(7f, 16f); lineTo(7.1f, 16f)
        }
    }

    val Subscriptions: ImageVector by lazy {
        strokeIcon("Subscriptions") {
            moveTo(3f, 7f); lineTo(9f, 7f); lineTo(11f, 9f); lineTo(21f, 9f)
            lineTo(21f, 19f); lineTo(3f, 19f); close()
        }
    }

    val Routing: ImageVector by lazy {
        strokeIcon("Routing") {
            moveTo(5f, 6f); lineTo(11f, 6f); lineTo(15f, 18f); lineTo(19f, 18f)
            moveTo(5f, 18f); lineTo(11f, 18f); lineTo(15f, 6f); lineTo(19f, 6f)
            moveTo(17f, 4f); lineTo(19f, 6f); lineTo(17f, 8f)
            moveTo(17f, 16f); lineTo(19f, 18f); lineTo(17f, 20f)
        }
    }

    val Settings: ImageVector by lazy {
        strokeIcon("Settings") {
            moveTo(12f, 9f)
            arcTo(3f, 3f, 0f, isMoreThanHalf = false, isPositiveArc = true, 12f, 15f)
            arcTo(3f, 3f, 0f, isMoreThanHalf = false, isPositiveArc = true, 12f, 9f)
            moveTo(12f, 3f); lineTo(12f, 5f)
            moveTo(12f, 19f); lineTo(12f, 21f)
            moveTo(3f, 12f); lineTo(5f, 12f)
            moveTo(19f, 12f); lineTo(21f, 12f)
            moveTo(5.6f, 5.6f); lineTo(7.1f, 7.1f)
            moveTo(16.9f, 16.9f); lineTo(18.4f, 18.4f)
            moveTo(18.4f, 5.6f); lineTo(16.9f, 7.1f)
            moveTo(7.1f, 16.9f); lineTo(5.6f, 18.4f)
        }
    }

    val Tools: ImageVector by lazy {
        strokeIcon("Tools") {
            moveTo(4f, 7f); lineTo(20f, 7f)
            moveTo(4f, 12f); lineTo(20f, 12f)
            moveTo(4f, 17f); lineTo(20f, 17f)
            moveTo(9f, 5f); lineTo(9f, 9f)
            moveTo(15f, 10f); lineTo(15f, 14f)
            moveTo(11f, 15f); lineTo(11f, 19f)
        }
    }

    val Power: ImageVector by lazy {
        strokeIcon("Power") {
            moveTo(12f, 3f); lineTo(12f, 11f)
            moveTo(7.05f, 6.05f)
            arcTo(7.5f, 7.5f, 0f, isMoreThanHalf = true, isPositiveArc = false, 16.95f, 6.05f)
        }
    }

    val Play: ImageVector by lazy {
        strokeIcon("Play") {
            moveTo(7f, 5f); lineTo(19f, 12f); lineTo(7f, 19f); close()
        }
    }

    val Stop: ImageVector by lazy {
        strokeIcon("Stop") {
            moveTo(6.5f, 6.5f); lineTo(17.5f, 6.5f); lineTo(17.5f, 17.5f); lineTo(6.5f, 17.5f); close()
        }
    }

    val Plus: ImageVector by lazy {
        strokeIcon("Plus") {
            moveTo(12f, 5f); lineTo(12f, 19f)
            moveTo(5f, 12f); lineTo(19f, 12f)
        }
    }

    val Refresh: ImageVector by lazy {
        strokeIcon("Refresh") {
            moveTo(20f, 12f)
            arcTo(8f, 8f, 0f, isMoreThanHalf = true, isPositiveArc = true, 17.6f, 6.3f)
            moveTo(20f, 4f); lineTo(20f, 8f); lineTo(16f, 8f)
        }
    }

    val Trash: ImageVector by lazy {
        strokeIcon("Trash") {
            moveTo(4f, 7f); lineTo(20f, 7f)
            moveTo(9f, 7f); lineTo(9f, 4f); lineTo(15f, 4f); lineTo(15f, 7f)
            moveTo(6f, 7f); lineTo(7f, 20f); lineTo(17f, 20f); lineTo(18f, 7f)
            moveTo(10f, 11f); lineTo(10f, 16f)
            moveTo(14f, 11f); lineTo(14f, 16f)
        }
    }

    val Search: ImageVector by lazy {
        strokeIcon("Search") {
            moveTo(11f, 5f)
            arcTo(6f, 6f, 0f, isMoreThanHalf = false, isPositiveArc = true, 11f, 17f)
            arcTo(6f, 6f, 0f, isMoreThanHalf = false, isPositiveArc = true, 11f, 5f)
            moveTo(15.5f, 15.5f); lineTo(20f, 20f)
        }
    }

    val Speed: ImageVector by lazy {
        strokeIcon("Speed") {
            moveTo(13f, 3f); lineTo(5f, 14f); lineTo(12f, 14f); lineTo(11f, 21f); lineTo(19f, 10f); lineTo(12f, 10f); close()
        }
    }

    val Gauge: ImageVector by lazy {
        strokeIcon("Gauge") {
            moveTo(4f, 15f)
            arcTo(8f, 8f, 0f, isMoreThanHalf = true, isPositiveArc = true, 20f, 15f)
            moveTo(12f, 15f); lineTo(16.5f, 10.5f)
            moveTo(11.5f, 15f)
            arcTo(0.5f, 0.5f, 0f, isMoreThanHalf = false, isPositiveArc = true, 12.5f, 15f)
            arcTo(0.5f, 0.5f, 0f, isMoreThanHalf = false, isPositiveArc = true, 11.5f, 15f)
        }
    }

    val Globe: ImageVector by lazy {
        strokeIcon("Globe") {
            moveTo(12f, 3f)
            arcTo(9f, 9f, 0f, isMoreThanHalf = false, isPositiveArc = true, 12f, 21f)
            arcTo(9f, 9f, 0f, isMoreThanHalf = false, isPositiveArc = true, 12f, 3f)
            moveTo(3f, 12f); lineTo(21f, 12f)
            moveTo(12f, 3f); quadTo(16f, 12f, 12f, 21f)
            moveTo(12f, 3f); quadTo(8f, 12f, 12f, 21f)
        }
    }

    val Shield: ImageVector by lazy {
        strokeIcon("Shield") {
            moveTo(12f, 3f); lineTo(19f, 6f); lineTo(19f, 12f)
            quadTo(19f, 18f, 12f, 21f)
            quadTo(5f, 18f, 5f, 12f)
            lineTo(5f, 6f); close()
        }
    }

    val Copy: ImageVector by lazy {
        strokeIcon("Copy") {
            moveTo(9f, 9f); lineTo(19f, 9f); lineTo(19f, 19f); lineTo(9f, 19f); close()
            moveTo(5f, 15f); lineTo(5f, 5f); lineTo(15f, 5f)
        }
    }

    val Edit: ImageVector by lazy {
        strokeIcon("Edit") {
            moveTo(4f, 20f); lineTo(8f, 19f); lineTo(19f, 8f); lineTo(16f, 5f); lineTo(5f, 16f); close()
        }
    }

    val ChevronRight: ImageVector by lazy {
        strokeIcon("ChevronRight") {
            moveTo(9f, 6f); lineTo(15f, 12f); lineTo(9f, 18f)
        }
    }

    val ArrowBack: ImageVector by lazy {
        strokeIcon("ArrowBack") {
            moveTo(19f, 12f); lineTo(5f, 12f)
            moveTo(11f, 6f); lineTo(5f, 12f); lineTo(11f, 18f)
        }
    }

    val ArrowUp: ImageVector by lazy {
        strokeIcon("ArrowUp") {
            moveTo(12f, 19f); lineTo(12f, 5f)
            moveTo(7f, 10f); lineTo(12f, 5f); lineTo(17f, 10f)
        }
    }

    val ArrowDown: ImageVector by lazy {
        strokeIcon("ArrowDown") {
            moveTo(12f, 5f); lineTo(12f, 19f)
            moveTo(7f, 14f); lineTo(12f, 19f); lineTo(17f, 14f)
        }
    }

    val Apps: ImageVector by lazy {
        strokeIcon("Apps") {
            moveTo(4f, 4f); lineTo(10f, 4f); lineTo(10f, 10f); lineTo(4f, 10f); close()
            moveTo(14f, 4f); lineTo(20f, 4f); lineTo(20f, 10f); lineTo(14f, 10f); close()
            moveTo(4f, 14f); lineTo(10f, 14f); lineTo(10f, 20f); lineTo(4f, 20f); close()
            moveTo(14f, 14f); lineTo(20f, 14f); lineTo(20f, 20f); lineTo(14f, 20f); close()
        }
    }

    val Terminal: ImageVector by lazy {
        strokeIcon("Terminal") {
            moveTo(4f, 6f); lineTo(20f, 6f); lineTo(20f, 18f); lineTo(4f, 18f); close()
            moveTo(8f, 10f); lineTo(10.5f, 12f); lineTo(8f, 14f)
            moveTo(12.5f, 14f); lineTo(16f, 14f)
        }
    }

    val Check: ImageVector by lazy {
        strokeIcon("Check") {
            moveTo(5f, 12f); lineTo(10f, 17f); lineTo(19f, 7f)
        }
    }

    val MoreVert: ImageVector by lazy {
        strokeIcon("MoreVert") {
            moveTo(12f, 5.5f); lineTo(12f, 6f)
            moveTo(12f, 11.75f); lineTo(12f, 12.25f)
            moveTo(12f, 18f); lineTo(12f, 18.5f)
        }
    }

    val Locate: ImageVector by lazy {
        strokeIcon("Locate") {
            moveTo(12f, 4f)
            arcTo(8f, 8f, 0f, isMoreThanHalf = false, isPositiveArc = true, 12f, 20f)
            arcTo(8f, 8f, 0f, isMoreThanHalf = false, isPositiveArc = true, 12f, 4f)
            moveTo(12f, 10.5f)
            arcTo(1.5f, 1.5f, 0f, isMoreThanHalf = false, isPositiveArc = true, 12f, 13.5f)
            arcTo(1.5f, 1.5f, 0f, isMoreThanHalf = false, isPositiveArc = true, 12f, 10.5f)
        }
    }

    val Palette: ImageVector by lazy {
        strokeIcon("Palette") {
            moveTo(12f, 3f)
            arcTo(9f, 9f, 0f, isMoreThanHalf = true, isPositiveArc = false, 21f, 12f)
            quadTo(21f, 15.5f, 17.5f, 15.5f)
            lineTo(15.5f, 15.5f)
            quadTo(14f, 15.5f, 14f, 17f)
            quadTo(14f, 21f, 12f, 21f)
            moveTo(8f, 10f); lineTo(8.1f, 10f)
            moveTo(12f, 7.5f); lineTo(12.1f, 7.5f)
            moveTo(16f, 10f); lineTo(16.1f, 10f)
        }
    }

    val FilterList: ImageVector by lazy {
        strokeIcon("FilterList") {
            moveTo(4f, 6f); lineTo(20f, 6f)
            moveTo(7f, 12f); lineTo(17f, 12f)
            moveTo(10f, 18f); lineTo(14f, 18f)
        }
    }

    val Info: ImageVector by lazy {
        strokeIcon("Info") {
            moveTo(12f, 3f)
            arcTo(9f, 9f, 0f, isMoreThanHalf = false, isPositiveArc = true, 12f, 21f)
            arcTo(9f, 9f, 0f, isMoreThanHalf = false, isPositiveArc = true, 12f, 3f)
            moveTo(12f, 11f); lineTo(12f, 16f)
            moveTo(12f, 8f); lineTo(12.1f, 8f)
        }
    }

    val Device: ImageVector by lazy {
        strokeIcon("Device") {
            moveTo(3f, 6f); lineTo(15f, 6f); lineTo(15f, 15f); lineTo(3f, 15f); close()
            moveTo(6f, 18f); lineTo(12f, 18f)
            moveTo(17f, 9f); lineTo(21f, 9f); lineTo(21f, 18f); lineTo(17f, 18f); close()
        }
    }
}
