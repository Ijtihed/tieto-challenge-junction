// Schema CPG sidecar entry point.
// Starts an MCP-compatible HTTP server exposing CPG analysis tools.
package dev.schema.cpg

import de.fraunhofer.aisec.cpg.TranslationConfiguration
import de.fraunhofer.aisec.cpg.TranslationManager
import java.io.File
import java.net.InetSocketAddress
import com.sun.net.httpserver.HttpServer
import com.sun.net.httpserver.HttpExchange

fun main(args: Array<String>) {
    var port = 7475
    var i = 0
    while (i < args.size) {
        when (args[i]) {
            "--http" -> { port = args.getOrNull(i + 1)?.toIntOrNull() ?: 7475; i += 2 }
            "--port" -> { port = args.getOrNull(i + 1)?.toIntOrNull() ?: 7475; i += 2 }
            else -> i++
        }
    }

    println("[schema-cpg] starting MCP server on port $port")

    val server = HttpServer.create(InetSocketAddress("127.0.0.1", port), 0)

    server.createContext("/mcp") { exchange ->
        exchange.responseHeaders.add("Access-Control-Allow-Origin", "*")
        exchange.responseHeaders.add("Access-Control-Allow-Methods", "POST, OPTIONS")
        exchange.responseHeaders.add("Access-Control-Allow-Headers", "Content-Type")

        if (exchange.requestMethod == "OPTIONS") {
            exchange.sendResponseHeaders(204, -1)
            return@createContext
        }

        if (exchange.requestMethod != "POST") {
            sendJson(exchange, 405, """{"error":"Method not allowed"}""")
            return@createContext
        }

        val body = exchange.requestBody.bufferedReader().readText()
        val response = handleJsonRpc(body)
        sendJson(exchange, 200, response)
    }

    server.executor = null
    server.start()
    println("[schema-cpg] ready at http://127.0.0.1:$port/mcp")

    Runtime.getRuntime().addShutdownHook(Thread {
        println("[schema-cpg] shutting down")
        server.stop(1)
    })

    Thread.currentThread().join()
}

private var translationResult: de.fraunhofer.aisec.cpg.TranslationResult? = null

private fun handleJsonRpc(body: String): String {
    val parsed = try {
        parseJsonRpc(body)
    } catch (e: Exception) {
        return """{"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error"},"id":null}"""
    }

    val id = parsed.id
    return when (parsed.method) {
        "initialize" -> jsonRpcResult(id, """{"name":"schema-cpg","version":"0.1.0","capabilities":{"tools":{}}}""")
        "ping" -> jsonRpcResult(id, "{}")
        "tools/list" -> jsonRpcResult(id, toolsList())
        "tools/call" -> {
            val toolName = parsed.toolName ?: return jsonRpcError(id, -32602, "Missing tool name")
            val toolArgs = parsed.toolArgs
            val result = callTool(toolName, toolArgs)
            jsonRpcResult(id, """{"content":[{"type":"text","text":${escapeJson(result)}}],"isError":false}""")
        }
        else -> jsonRpcError(id, -32601, "Method not found: ${parsed.method}")
    }
}

private fun callTool(name: String, args: Map<String, String>): String {
    return when (name) {
        "cpg_analyze" -> {
            val sourceDir = args["sourceDir"] ?: return """{"ok":false,"message":"Missing sourceDir"}"""
            analyze(sourceDir)
        }
        "cpg_status" -> {
            val hasResult = translationResult != null
            """{"ok":true,"data":{"analyzed":$hasResult}}"""
        }
        else -> """{"ok":false,"message":"Unknown tool: $name"}"""
    }
}

private fun analyze(sourceDir: String): String {
    return try {
        val dir = File(sourceDir)
        if (!dir.isDirectory) return """{"ok":false,"message":"Not a directory: $sourceDir"}"""

        val config = TranslationConfiguration.builder()
            .sourceLocations(dir)
            .defaultPasses()
            .defaultLanguages()
            .build()

        val manager = TranslationManager.builder().config(config).build()
        val result = manager.analyze().get()
        translationResult = result

        val nodeCount = result.components.sumOf { it.translationUnits.size }
        """{"ok":true,"data":{"nodeCount":$nodeCount,"languages":[]}}"""
    } catch (e: Exception) {
        """{"ok":false,"message":"Analysis failed: ${e.message?.replace("\"", "'")}"}"""
    }
}

private fun toolsList(): String {
    return """{
        "tools": [
            {"name":"cpg_analyze","description":"Analyze source code with CPG","inputSchema":{"type":"object","properties":{"sourceDir":{"type":"string"}},"required":["sourceDir"]}},
            {"name":"cpg_status","description":"Check CPG analysis status","inputSchema":{"type":"object","properties":{}}}
        ]
    }"""
}

// Minimal JSON-RPC parser (avoids external dependency)
private data class JsonRpcRequest(val method: String, val id: Any?, val toolName: String?, val toolArgs: Map<String, String>)

private fun parseJsonRpc(body: String): JsonRpcRequest {
    val method = extractString(body, "method") ?: throw IllegalArgumentException("Missing method")
    val id = extractValue(body, "id")

    var toolName: String? = null
    var toolArgs = emptyMap<String, String>()

    if (method == "tools/call") {
        val paramsStart = body.indexOf("\"params\"")
        if (paramsStart >= 0) {
            toolName = extractString(body.substring(paramsStart), "name")
            val argsStart = body.indexOf("\"arguments\"", paramsStart)
            if (argsStart >= 0) {
                val braceStart = body.indexOf('{', argsStart + 11)
                if (braceStart >= 0) {
                    val braceEnd = findMatchingBrace(body, braceStart)
                    if (braceEnd > braceStart) {
                        toolArgs = parseSimpleObject(body.substring(braceStart, braceEnd + 1))
                    }
                }
            }
        }
    }

    return JsonRpcRequest(method, id, toolName, toolArgs)
}

private fun extractString(json: String, key: String): String? {
    val keyIdx = json.indexOf("\"$key\"")
    if (keyIdx < 0) return null
    val colonIdx = json.indexOf(':', keyIdx + key.length + 2)
    if (colonIdx < 0) return null
    val quoteStart = json.indexOf('"', colonIdx + 1)
    if (quoteStart < 0) return null
    val quoteEnd = json.indexOf('"', quoteStart + 1)
    if (quoteEnd < 0) return null
    return json.substring(quoteStart + 1, quoteEnd)
}

private fun extractValue(json: String, key: String): Any? {
    return extractString(json, key) ?: run {
        val keyIdx = json.indexOf("\"$key\"")
        if (keyIdx < 0) return null
        val colonIdx = json.indexOf(':', keyIdx + key.length + 2)
        if (colonIdx < 0) return null
        val valueStart = json.substring(colonIdx + 1).trimStart()
        if (valueStart.startsWith("null")) null
        else valueStart.takeWhile { it.isDigit() || it == '-' }.toIntOrNull()
    }
}

private fun findMatchingBrace(s: String, start: Int): Int {
    var depth = 0
    for (i in start until s.length) {
        when (s[i]) {
            '{' -> depth++
            '}' -> { depth--; if (depth == 0) return i }
        }
    }
    return -1
}

private fun parseSimpleObject(json: String): Map<String, String> {
    val result = mutableMapOf<String, String>()
    val inner = json.trim().removeSurrounding("{", "}").trim()
    if (inner.isEmpty()) return result
    val regex = Regex(""""([^"]+)"\s*:\s*"([^"]*)"""")
    for (match in regex.findAll(inner)) {
        result[match.groupValues[1]] = match.groupValues[2]
    }
    return result
}

private fun jsonRpcResult(id: Any?, result: String): String {
    return """{"jsonrpc":"2.0","result":$result,"id":${formatId(id)}}"""
}

private fun jsonRpcError(id: Any?, code: Int, message: String): String {
    return """{"jsonrpc":"2.0","error":{"code":$code,"message":"$message"},"id":${formatId(id)}}"""
}

private fun formatId(id: Any?): String = when (id) {
    null -> "null"
    is Int -> id.toString()
    is String -> "\"$id\""
    else -> id.toString()
}

private fun escapeJson(s: String): String {
    return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""
}

private fun sendJson(exchange: HttpExchange, status: Int, body: String) {
    val bytes = body.toByteArray(Charsets.UTF_8)
    exchange.responseHeaders.add("Content-Type", "application/json")
    exchange.sendResponseHeaders(status, bytes.size.toLong())
    exchange.responseBody.use { it.write(bytes) }
}
