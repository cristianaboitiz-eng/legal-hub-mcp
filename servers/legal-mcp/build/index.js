import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "child_process";
import * as readline from "readline";
import * as path from "path";
import * as os from "os";

// ---------------------------------------------------------------------------
// Rutas dinamicas - funciona en cualquier PC Windows
// ---------------------------------------------------------------------------
const HOME = os.homedir();
const NODE = process.execPath;
const LEGAL_MCP = path.join(HOME, "legal-hub", "servers", "legal-mcp");
const SAIJ_DIR = path.join(HOME, "legal-hub", "servers", "saij-mcp");

const CONNECTORS = [
    {
        prefix: "bora",
        command: NODE,
        args: [path.join(LEGAL_MCP, "build", "bora.js")],
        cwd: LEGAL_MCP,
        env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    },
    {
        prefix: "bopba",
        command: NODE,
        args: [path.join(LEGAL_MCP, "build", "bopba.js")],
        cwd: LEGAL_MCP,
        env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    },
    {
        prefix: "infoleg",
        command: NODE,
        args: [path.join(LEGAL_MCP, "build", "infoleg.js")],
        cwd: LEGAL_MCP,
        env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    },
    {
        prefix: "normativapba",
        command: NODE,
        args: [path.join(LEGAL_MCP, "build", "normativapba.js")],
        cwd: LEGAL_MCP,
        env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    },
    {
        prefix: "juba",
        command: NODE,
        args: [path.join(LEGAL_MCP, "build", "juba.js")],
        cwd: LEGAL_MCP,
        env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    },
    {
        prefix: "pjn",
        command: NODE,
        args: [path.join(LEGAL_MCP, "build", "pjn.js")],
        cwd: LEGAL_MCP,
        env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    },
    {
        prefix: "ptn",
        command: NODE,
        args: [path.join(LEGAL_MCP, "build", "ptn.js")],
        cwd: LEGAL_MCP,
        env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    },
    {
        prefix: "pjnjuris",
        command: NODE,
        args: [path.join(LEGAL_MCP, "build", "pjnjuris.js")],
        cwd: LEGAL_MCP,
        env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    },
    {
        prefix: "tfn",
        command: NODE,
        args: [path.join(LEGAL_MCP, "build", "tfn.js")],
        cwd: LEGAL_MCP,
        env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    },
    {
        prefix: "saij",
        command: NODE,
        args: [path.join(SAIJ_DIR, "build", "index.js")],
        cwd: SAIJ_DIR,
    },
    {
        prefix: "scba",
        command: NODE,
        args: [path.join(LEGAL_MCP, "build", "scba.js")],
        cwd: LEGAL_MCP,
    },
];

class ChildMcpClient {
    prefix;
    proc;
    rl;
    pending = new Map();
    idCounter = 1;
    tools = [];
    ready = false;

    constructor(prefix, config) {
        this.prefix = prefix;
        const env = { ...process.env, ...(config.env ?? {}) };
        this.proc = spawn(config.command, config.args, {
            cwd: config.cwd,
            env,
            stdio: ["pipe", "pipe", "pipe"],
        });
        this.rl = readline.createInterface({ input: this.proc.stdout });
        this.rl.on("line", (line) => {
            line = line.trim();
            if (!line) return;
            try {
                const msg = JSON.parse(line);
                if (msg.id !== undefined) {
                    const pending = this.pending.get(msg.id);
                    if (pending) {
                        this.pending.delete(msg.id);
                        if (msg.error) {
                            pending.reject(new Error(`[${this.prefix}] ${msg.error.message} (code ${msg.error.code})`));
                        } else {
                            pending.resolve(msg.result);
                        }
                    }
                }
            } catch {
                // linea no JSON - ignorar
            }
        });
        this.proc.stderr?.on("data", (d) => {
            const txt = d.toString().trim();
            if (txt) process.stderr.write(`[${this.prefix}] ${txt}\n`);
        });
        this.proc.on("exit", (code) => {
            process.stderr.write(`[${this.prefix}] proceso terminado (code ${code})\n`);
        });
    }

    send(method, params) {
        return new Promise((resolve, reject) => {
            const id = this.idCounter++;
            const req = { jsonrpc: "2.0", id, method, params: params ?? {} };
            this.pending.set(id, { resolve, reject });
            try {
                this.proc.stdin.write(JSON.stringify(req) + "\n");
            } catch (e) {
                this.pending.delete(id);
                reject(e);
            }
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error(`[${this.prefix}] timeout en ${method}`));
                }
            }, 15000);
        });
    }

    notify(method, params) {
        const msg = { jsonrpc: "2.0", method, params: params ?? {} };
        try {
            this.proc.stdin.write(JSON.stringify(msg) + "\n");
        } catch {
            // ignorar errores en notificaciones
        }
    }

    async initialize() {
        await this.send("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            clientInfo: { name: "legal-hub-proxy", version: "1.0.0" },
        });
        this.notify("notifications/initialized");
        const result = (await this.send("tools/list", {}));
        this.tools = (result.tools ?? []).map((t) => ({
            ...t,
            name: `${this.prefix}__${t.name}`,
        }));
        this.ready = true;
        process.stderr.write(`[${this.prefix}] ok - ${this.tools.length} tools\n`);
    }

    async callTool(prefixedName, args) {
        const originalName = prefixedName.replace(`${this.prefix}__`, "");
        return this.send("tools/call", { name: originalName, arguments: args });
    }

    kill() {
        this.proc.kill();
    }
}

// ---------------------------------------------------------------------------
// Servidor principal
// ---------------------------------------------------------------------------
async function main() {
    const server = new Server(
        { name: "legal-hub", version: "2.0.0" },
        { capabilities: { tools: {} } }
    );

    process.stderr.write("[legal-hub] iniciando conectores...\n");

    const clients = [];
    await Promise.allSettled(
        CONNECTORS.map(async (cfg) => {
            const client = new ChildMcpClient(cfg.prefix, cfg);
            try {
                await client.initialize();
                clients.push(client);
            } catch (e) {
                process.stderr.write(`[${cfg.prefix}] ERROR: ${e.message}\n`);
            }
        })
    );

    const toolMap = new Map();
    const allTools = [];
    for (const client of clients) {
        for (const tool of client.tools) {
            toolMap.set(tool.name, client);
            allTools.push(tool);
        }
    }

    process.stderr.write(`[legal-hub] listo - ${clients.length} conectores, ${allTools.length} tools totales\n`);

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: allTools.map((t) => ({
            name: t.name,
            description: t.description ?? "",
            inputSchema: t.inputSchema ?? { type: "object", properties: {} },
        })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args = {} } = request.params;

        const client = toolMap.get(name);
        if (!client) {
            return {
                content: [{ type: "text", text: `Tool "${name}" no encontrada.` }],
                isError: true,
            };
        }

        try {
            const result = await client.callTool(name, args);
            if (result && typeof result === "object" && "content" in result) {
                return result;
            }
            return {
                content: [
                    {
                        type: "text",
                        text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
                    },
                ],
            };
        } catch (e) {
            return {
                content: [{ type: "text", text: `Error: ${e.message}` }],
                isError: true,
            };
        }
    });

    process.on("SIGINT", () => {
        clients.forEach((c) => c.kill());
        process.exit(0);
    });
    process.on("SIGTERM", () => {
        clients.forEach((c) => c.kill());
        process.exit(0);
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write("[legal-hub] conectado y escuchando\n");
}

main().catch((e) => {
    process.stderr.write(`[legal-hub] error fatal: ${e.message}\n`);
    process.exit(1);
});
