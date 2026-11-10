import { describe, expect, it } from "vitest";
import { validateAndNormalize, ValidationError, isDisposableDomain, isRoleAccount } from "../../src/utils/input";

describe("validateAndNormalize", () => {
  it("accepts a valid email and normalizes case", () => {
    const r = validateAndNormalize("EMAIL", "  Alice.Example@Gmail.COM ");
    expect(r.value).toBe("alice.example@gmail.com");
    expect(r.related).toBe("gmail.com");
  });

  it("rejects invalid emails", () => {
    for (const bad of ["not-an-email", "a@b", "a@", "@domain.com", "a b@c.com", "a@-bad.com", "a@exa mple.com", ""]) {
      expect(() => validateAndNormalize("EMAIL", bad)).toThrow(ValidationError);
    }
  });

  it("accepts E.164 and national phone formats and normalizes to E.164", () => {
    expect(validateAndNormalize("PHONE", "+1 555 123 4567").value).toBe("+15551234567");
    expect(validateAndNormalize("PHONE", "447911123456").value).toBe("+447911123456");
  });

  it("rejects invalid phone numbers", () => {
    for (const bad of ["abc", "123", "+", "123456", "phone", ""]) {
      expect(() => validateAndNormalize("PHONE", bad)).toThrow(ValidationError);
    }
  });

  it("accepts valid IPs", () => {
    expect(validateAndNormalize("IP", "8.8.8.8").value).toBe("8.8.8.8");
    expect(validateAndNormalize("IP", "2001:db8::1").value).toContain("2001:0db8");
  });

  it("rejects invalid IPs", () => {
    for (const bad of ["999.1.1.1", "8.8.8", "abc", "2001:::1", ""]) {
      expect(() => validateAndNormalize("IP", bad)).toThrow(ValidationError);
    }
  });

  it("accepts valid domains and strips protocol/paths", () => {
    expect(validateAndNormalize("DOMAIN", "https://Example.COM/foo").value).toBe("example.com");
    expect(validateAndNormalize("DOMAIN", "sub.example.co.uk.").value).toBe("sub.example.co.uk");
  });

  it("rejects invalid domains", () => {
    for (const bad of ["http://", "example", "exa mple.com", "-example.com", "example..com", ""]) {
      expect(() => validateAndNormalize("DOMAIN", bad)).toThrow(ValidationError);
    }
  });

  it("accepts usernames", () => {
    expect(validateAndNormalize("USERNAME", "Alice_123").value).toBe("alice_123");
  });

  it("rejects invalid usernames", () => {
    for (const bad of ["ab", "a".repeat(40), "has space", "semi;colon", "", "sql'--", "<script>", "select union"]) {
      expect(() => validateAndNormalize("USERNAME", bad)).toThrow(ValidationError);
    }
  });

  it("rejects SQL injection and XSS payloads as domains/emails", () => {
    for (const bad of ["' OR 1=1--@example.com", "x'<script>alert(1)</script>'@example.com", "<script>alert(1)</script>.com"]) {
      expect(() => validateAndNormalize("DOMAIN", bad)).toThrow(ValidationError);
    }
  });
});

describe("email helpers", () => {
  it("detects disposable domains", () => {
    expect(isDisposableDomain("mailinator.com")).toBe(true);
    expect(isDisposableDomain("gmail.com")).toBe(false);
  });

  it("detects role accounts", () => {
    expect(isRoleAccount("admin")).toBe(true);
    expect(isRoleAccount("support")).toBe(true);
    expect(isRoleAccount("john.doe")).toBe(false);
  });
});
