describe("meliTokenService", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("does not refresh token when owner is external", async () => {
    process.env.MELI_TOKEN_REFRESH_OWNER = "external";
    process.env.MELI_TOKENS_SUPABASE_URL = "https://example.supabase.co";
    process.env.MELI_TOKENS_SUPABASE_SERVICE_ROLE_KEY = "service-role";

    const { refreshMeliToken } = await import("../../../services/MercadoLibre/meliTokenService");

    await expect(refreshMeliToken("refresh-token")).rejects.toThrow(
      "MercadoLibre external token expired. Refresh it from the token owner system."
    );
  });
});
