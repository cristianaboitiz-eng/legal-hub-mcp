import https from "https";
import axios from "axios";
const agents = {};
function envTlsInsecure() {
    return process.env.PTN_TLS_INSECURE === "1" || process.env.PTN_TLS_INSECURE === "true";
}
/**
 * HTTPS agent for api.ptn.gob.ar.
 * Strict verification by default. Use PTN_TLS_INSECURE=1 only when your OS/proxy
 * cannot validate the PTN certificate chain.
 */
export function getPtnHttpsAgent(insecure = envTlsInsecure()) {
    const key = insecure ? "insecure" : "strict";
    if (!agents[key]) {
        agents[key] = new https.Agent({ rejectUnauthorized: !insecure });
    }
    return agents[key];
}
function isTlsVerificationError(error) {
    if (!axios.isAxiosError(error))
        return false;
    const code = error.code ?? "";
    const message = error.message ?? "";
    return (code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
        code === "UNABLE_TO_VERIFY_CERT_SIGNATURE" ||
        code === "CERT_HAS_EXPIRED" ||
        message.includes("unable to verify") ||
        message.includes("certificate"));
}
let tlsFallbackWarned = false;
/**
 * POST helper: strict TLS first; one retry without verification only on cert errors.
 */
export async function ptnPost(url, body, config = {}) {
    const base = {
        ...config,
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...config.headers,
        },
        timeout: config.timeout ?? 45000,
    };
    if (envTlsInsecure()) {
        const response = await axios.post(url, body, {
            ...base,
            httpsAgent: getPtnHttpsAgent(true),
        });
        return response.data;
    }
    try {
        const response = await axios.post(url, body, {
            ...base,
            httpsAgent: getPtnHttpsAgent(false),
        });
        return response.data;
    }
    catch (error) {
        if (!isTlsVerificationError(error))
            throw error;
        if (!tlsFallbackWarned) {
            tlsFallbackWarned = true;
            console.error("PTN MCP: TLS verification failed; retrying without certificate check. " +
                "Set PTN_TLS_INSECURE=1 to use insecure TLS from the start.");
        }
        const response = await axios.post(url, body, {
            ...base,
            httpsAgent: getPtnHttpsAgent(true),
        });
        return response.data;
    }
}
//# sourceMappingURL=ptn-http.js.map