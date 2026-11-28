package app.supervpn.android.ui

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

val Purple = Color(0xFF7047D7)
val PurpleDark = Color(0xFF5A37B8)
val PurpleSoft = Color(0xFFEEE8FF)
val PurpleTint = Color(0xFFF6F2FF)
val Ink = Color(0xFF252340)
val Muted = Color(0xFF625D7C)
val Dim = Color(0xFF706981)
val Outline = Color(0xFFE4E0EF)
val CanvasBg = Color(0xFFF7F6FC)
val Success = Color(0xFF0D7767)
val SuccessSoft = Color(0xFFE4F5F1)
val Warning = Color(0xFF8A5B0C)
val WarningSoft = Color(0xFFFCF3E1)
val Danger = Color(0xFFB63E57)
val DangerSoft = Color(0xFFFBE5EB)

data class SuperVpnExtendedColors(
    val isDark: Boolean,
    val success: Color,
    val successContainer: Color,
    val warning: Color,
    val warningContainer: Color,
    val danger: Color,
    val dangerContainer: Color,
    val uploadAccent: Color,
    val downloadAccent: Color,
    val cardElevated: Color,
    val divider: Color,
)

private val lightExtended = SuperVpnExtendedColors(
    isDark = false,
    success = Success,
    successContainer = SuccessSoft,
    warning = Warning,
    warningContainer = WarningSoft,
    danger = Danger,
    dangerContainer = DangerSoft,
    uploadAccent = Color(0xFF0D7767),
    downloadAccent = Purple,
    cardElevated = Color(0xFFFAF8FF),
    divider = Color(0xFFE8E4F3),
)

private val darkExtended = SuperVpnExtendedColors(
    isDark = true,
    success = Color(0xFF34D399),
    successContainer = Color(0xFF133329),
    warning = Color(0xFFFBBF24),
    warningContainer = Color(0xFF382A12),
    danger = Color(0xFFFB7185),
    dangerContainer = Color(0xFF3F1924),
    uploadAccent = Color(0xFF2DD4BF),
    downloadAccent = Color(0xFFA78BFA),
    cardElevated = Color(0xFF221D32),
    divider = Color(0xFF2A253B),
)

val LocalSuperVpnColors = staticCompositionLocalOf { lightExtended }

private val light = lightColorScheme(
    primary = Purple,
    onPrimary = Color.White,
    primaryContainer = PurpleSoft,
    onPrimaryContainer = PurpleDark,
    secondary = PurpleDark,
    onSecondary = Color.White,
    secondaryContainer = PurpleTint,
    onSecondaryContainer = Purple,
    background = CanvasBg,
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    surfaceVariant = Color(0xFFF1EEF9),
    onSurfaceVariant = Muted,
    outline = Outline,
    outlineVariant = Color(0xFFECE8F6),
    error = Danger,
    onError = Color.White,
    errorContainer = DangerSoft,
    onErrorContainer = Danger,
)

private val dark = darkColorScheme(
    primary = Color(0xFFA78BFA),
    onPrimary = Color(0xFF1E1342),
    primaryContainer = Color(0xFF302454),
    onPrimaryContainer = Color(0xFFEDE7FF),
    secondary = Color(0xFFC4B5FD),
    onSecondary = Color(0xFF1E1342),
    secondaryContainer = Color(0xFF261E3D),
    onSecondaryContainer = Color(0xFFE6DEFF),
    background = Color(0xFF110F18),
    onBackground = Color(0xFFF1EEF9),
    surface = Color(0xFF191623),
    onSurface = Color(0xFFF1EEF9),
    surfaceVariant = Color(0xFF252034),
    onSurfaceVariant = Color(0xFFA9A2BF),
    outline = Color(0xFF312B45),
    outlineVariant = Color(0xFF282339),
    error = Color(0xFFFB7185),
    onError = Color(0xFF420D1A),
    errorContainer = Color(0xFF3F1924),
    onErrorContainer = Color(0xFFFFD8DF),
)

private val typography = Typography(
    headlineSmall = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.3).sp),
    titleMedium = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.SemiBold),
    bodyMedium = TextStyle(fontSize = 14.sp),
    bodySmall = TextStyle(fontSize = 12.sp),
    labelMedium = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium),
)

@Composable
fun SuperVpnTheme(
    themeMode: String = "system",
    content: @Composable () -> Unit,
) {
    val useDark = when (themeMode) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }
    val scheme = if (useDark) dark else light
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            @Suppress("DEPRECATION")
            window.statusBarColor = scheme.background.toArgb()
            @Suppress("DEPRECATION")
            window.navigationBarColor = scheme.surface.toArgb()
            val controller = WindowCompat.getInsetsController(window, view)
            controller.isAppearanceLightStatusBars = !useDark
            controller.isAppearanceLightNavigationBars = !useDark
        }
    }
    CompositionLocalProvider(
        LocalSuperVpnColors provides if (useDark) darkExtended else lightExtended,
    ) {
        MaterialTheme(
            colorScheme = scheme,
            typography = typography,
            content = content,
        )
    }
}
