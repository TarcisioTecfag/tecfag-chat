import { afterEach, describe, expect, test } from "bun:test";
import {
  buildLogoutCookie,
  buildLogoutCookies,
  buildSessionCookie,
  extractSessionToken,
  extractSessionTokens,
  isAllowedIframeOrigin,
  parseCookies,
  shouldUsePartitionedSessionCookie,
} from "../src/lib/auth-session";

const originalAllowedIframeOrigins = process.env.ALLOWED_IFRAME_ORIGINS;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalAllowedIframeOrigins === undefined) {
    delete process.env.ALLOWED_IFRAME_ORIGINS;
  } else {
    process.env.ALLOWED_IFRAME_ORIGINS = originalAllowedIframeOrigins;
  }
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

describe("auth-session iframe CHIPS cookies & cookie parsing", () => {
  test("autoriza KRONOS por padrão e normaliza barra final/maiúsculas", () => {
    expect(isAllowedIframeOrigin("https://kronos-3qsu.onrender.com")).toBe(true);
    expect(isAllowedIframeOrigin("HTTPS://KRONOS-3QSU.ONRENDER.COM/")).toBe(true);
    expect(isAllowedIframeOrigin("https://kronos-3qsu.onrender.com/dashboard")).toBe(true);
    expect(isAllowedIframeOrigin("https://evil.example.com")).toBe(false);
    expect(isAllowedIframeOrigin("http://kronos-3qsu.onrender.com")).toBe(false);
    expect(isAllowedIframeOrigin("")).toBe(false);
    expect(isAllowedIframeOrigin(null)).toBe(false);
  });

  test("suporta origens extras via ALLOWED_IFRAME_ORIGINS", () => {
    process.env.ALLOWED_IFRAME_ORIGINS = "https://portal.tecfag.com.br/, https://intranet.tecfag.com.br";
    expect(isAllowedIframeOrigin("https://portal.tecfag.com.br")).toBe(true);
    expect(isAllowedIframeOrigin("https://intranet.tecfag.com.br")).toBe(true);
    expect(isAllowedIframeOrigin("https://kronos-3qsu.onrender.com")).toBe(true);
    expect(isAllowedIframeOrigin("https://outro.com")).toBe(false);
  });

  test("shouldUsePartitionedSessionCookie libera somente para iframe autorizado em HTTPS", () => {
    const httpsReq = new Request("https://tecfagchat.up.railway.app/api/auth/login", { method: "POST" });
    const proxiedHttpsReq = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "x-forwarded-proto": "https" },
    });
    const plainHttpReq = new Request("http://localhost:3000/api/auth/login", { method: "POST" });

    process.env.NODE_ENV = "development";

    // Acesso direto nunca usa Partitioned
    expect(
      shouldUsePartitionedSessionCookie(httpsReq, {
        embedded: false,
        embedOrigin: "https://kronos-3qsu.onrender.com",
      }),
    ).toBe(false);

    // Iframe KRONOS em HTTPS -> usa Partitioned
    expect(
      shouldUsePartitionedSessionCookie(httpsReq, {
        embedded: true,
        embedOrigin: "https://kronos-3qsu.onrender.com",
      }),
    ).toBe(true);
    expect(
      shouldUsePartitionedSessionCookie(proxiedHttpsReq, {
        embedded: true,
        embedOrigin: "https://kronos-3qsu.onrender.com",
      }),
    ).toBe(true);

    // Origem desconhecida -> bloqueada
    expect(
      shouldUsePartitionedSessionCookie(httpsReq, {
        embedded: true,
        embedOrigin: "https://evil.com",
      }),
    ).toBe(false);

    // HTTP puro fora de produção -> nunca usa Partitioned
    expect(
      shouldUsePartitionedSessionCookie(plainHttpReq, {
        embedded: true,
        embedOrigin: "https://kronos-3qsu.onrender.com",
      }),
    ).toBe(false);
  });

  test("buildSessionCookie mantém SameSite=Lax no acesso direto e usa SameSite=None; Secure; Partitioned no iframe", () => {
    const expiresAt = new Date(Date.now() + 3600 * 1000);

    const directCookie = buildSessionCookie("tok123", expiresAt, { partitioned: false, secure: true });
    expect(directCookie).toContain("session_token=tok123");
    expect(directCookie).toContain("SameSite=Lax");
    expect(directCookie).toContain("Secure");
    expect(directCookie).not.toContain("SameSite=None");
    expect(directCookie).not.toContain("Partitioned");

    const iframeCookie = buildSessionCookie("tok123", expiresAt, { partitioned: true, secure: true });
    expect(iframeCookie).toContain("session_token=tok123");
    expect(iframeCookie).toContain("HttpOnly");
    expect(iframeCookie).toContain("SameSite=None");
    expect(iframeCookie).toContain("Secure");
    expect(iframeCookie).toContain("Partitioned");
    expect(iframeCookie).not.toContain("SameSite=Lax");

    // Partitioned sem Secure nunca emite Partitioned
    const nonSecureFallback = buildSessionCookie("tok123", expiresAt, { partitioned: true, secure: false });
    expect(nonSecureFallback).toContain("SameSite=Lax");
    expect(nonSecureFallback).not.toContain("Partitioned");
  });

  test("buildLogoutCookies limpa tanto cookie padrão quanto Partitioned em HTTPS", () => {
    const secureCookies = buildLogoutCookies({ secure: true });
    expect(secureCookies.length).toBe(2);
    expect(secureCookies[0]).toContain("SameSite=Lax");
    expect(secureCookies[0]).toContain("Max-Age=0");
    expect(secureCookies[0]).toContain("Secure");
    expect(secureCookies[1]).toContain("SameSite=None");
    expect(secureCookies[1]).toContain("Secure");
    expect(secureCookies[1]).toContain("Partitioned");
    expect(secureCookies[1]).toContain("Max-Age=0");

    const devCookies = buildLogoutCookies({ secure: false });
    expect(devCookies.length).toBe(1);
    expect(devCookies[0]).toBe(buildLogoutCookie({ secure: false }));
  });

  test("extractSessionTokens preserva múltiplos cookies session_token e tolera cookies malformados", () => {
    const req = new Request("https://tecfagchat.up.railway.app/api/auth/session", {
      headers: {
        Cookie: "broken=%E0%A4%A; session_token=valid_new; other=1; session_token=stale_old; session_token=valid_new",
      },
    });

    const parsed = parseCookies(req);
    expect(parsed.broken).toBe("%E0%A4%A");
    expect(parsed.other).toBe("1");

    const tokens = extractSessionTokens(req);
    expect(tokens).toEqual(["valid_new", "stale_old"]);
    expect(extractSessionToken(req)).toBe("valid_new");
  });
});
