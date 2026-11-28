package app.supervpn.android.data

import android.content.Context
import android.os.Build
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Persists uncaught crash stack traces (with URLs redacted) so device-specific
 * startup failures can be inspected directly on screen instead of closing silently.
 */
object CrashGuard {
    private const val FILE_NAME = "last_crash.txt"
    private val urlPattern = Regex("""[a-zA-Z][a-zA-Z0-9+.-]*://\S+""")

    fun install(context: Context) {
        val appContext = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching { record(appContext, thread.name, throwable) }
            previous?.uncaughtException(thread, throwable)
        }
    }

    fun record(context: Context, source: String, throwable: Throwable) {
        val sw = StringWriter()
        throwable.printStackTrace(PrintWriter(sw))
        val sanitizedStack = urlPattern.replace(sw.toString(), "[redacted-url]").take(8000)
        val header = buildString {
            appendLine("Time: ${SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())}")
            appendLine("Device: ${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE}, API ${Build.VERSION.SDK_INT})")
            appendLine("Source: $source")
            appendLine()
            append(sanitizedStack)
        }
        runCatching { File(context.filesDir, FILE_NAME).writeText(header, Charsets.UTF_8) }
    }

    fun read(context: Context): String? = runCatching {
        val file = File(context.filesDir, FILE_NAME)
        if (file.exists()) file.readText(Charsets.UTF_8).takeIf { it.isNotBlank() } else null
    }.getOrNull()

    fun clear(context: Context) {
        runCatching { File(context.filesDir, FILE_NAME).delete() }
    }
}
