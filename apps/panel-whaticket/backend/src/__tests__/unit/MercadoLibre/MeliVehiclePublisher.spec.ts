jest.mock("../../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

jest.mock("../../../services/MercadoLibre/meliTokenService", () => ({
  getMeliTokenHealth: jest.fn(async () => ({
    hasTokenRow: true,
    hasAccessToken: true,
    hasRefreshToken: true
  })),
  MISSING_TOKEN_ROW_MESSAGE: "Missing MercadoLibre token row id=main",
  MISSING_TOKEN_VALUES_MESSAGE: "MercadoLibre token row id=main has no access_token"
}));

jest.mock("../../../helpers/meliCategoriesService", () => ({
  getCategoryAttributes: jest.fn(async () => []),
  mapVehicleToMeliAttributes: jest.fn(() => ({
    attributes: [],
    missingRequired: [],
    missingRecommended: []
  })),
  getCategoryDetails: jest.fn(async (categoryId: string) => ({
    id: categoryId,
    domain_id: "MLA-CARS_AND_VANS",
    settings: { listing_allowed: true }
  })),
  predictVehicleCategories: jest.fn(async () => [])
}));

import { publishVehicleToMeli } from "../../../services/MercadoLibre/meliVehiclePublisher";
import {
  getCategoryDetails,
  predictVehicleCategories
} from "../../../helpers/meliCategoriesService";

const mockedGetCategoryDetails = getCategoryDetails as jest.MockedFunction<typeof getCategoryDetails>;
const mockedPredictVehicleCategories = predictVehicleCategories as jest.MockedFunction<typeof predictVehicleCategories>;

const baseVehicle = {
  id: "vehicle-publish-1",
  title: "Toyota Corolla XEi 2.0 2021",
  brand: "Toyota",
  model: "Corolla",
  version: "XEi 2.0",
  year: 2021,
  km: 54000,
  price: "24500000",
  currency: "ARS",
  condition: "used",
  fuel: "Nafta",
  transmission: "Automatica",
  color: "Gris",
  locationCity: "Rosario",
  locationState: "Santa Fe",
  meliCategoryId: "MLA1744",
  meliDomainId: "MLA-CARS_AND_VANS",
  meliListingTypeId: null,
  meliAttributes: [],
  pictures: ["https://img.test/1.jpg"],
  meliItemId: null,
  meliPermalink: null,
  permalink: null,
  meliStatus: null
} as any;

const buildRequestMock = (overrides: Record<string, any> = {}) =>
  jest.fn(async (path: string) => {
    if (path === "/users/me") {
      return { ok: true, status: 200, body: { id: 123456, nickname: "dealer" } };
    }
    if (path === "/categories/MLA1743/classifieds_promotion_packs") {
      return {
        ok: true,
        status: 200,
        body: [
          { id: "gold", listing_type_id: "gold_special" },
          { id: "silver", listing_type_id: "silver" }
        ]
      };
    }
    if (path === "/users/123456/classifieds_promotion_packs") {
      return {
        ok: true,
        status: 200,
        body: [{ promotion_pack_id: "PK1", listing_type_id: "gold_special", available_listings: 2, status: "active" }]
      };
    }
    if (path === "/items") {
      return { ok: true, status: 201, body: { id: "MLA123", status: "active", permalink: "https://meli/item/MLA123" } };
    }
    if (path === "/items/MLA123/description") {
      return { ok: true, status: 200, body: { plain_text: "saved" } };
    }
    return overrides[path] || { ok: false, status: 404, body: { message: `Unhandled path ${path}` } };
  });

describe("publishVehicleToMeli preflight", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetCategoryDetails.mockResolvedValue({
      id: "MLA1744",
      domain_id: "MLA-CARS_AND_VANS",
      settings: { listing_allowed: true }
    } as any);
    mockedPredictVehicleCategories.mockResolvedValue([]);
  });

  it("publishes a complete used car after preflight resolves package quota", async () => {
    const request = buildRequestMock();

    const result = await publishVehicleToMeli(baseVehicle, {
      request,
      publishEnabled: true
    });

    expect(result.ok).toBe(true);
    expect(result.apiCalled).toBe(true);
    expect(result.payloadPreview.category_id).toBe("MLA1744");
    expect(result.payloadPreview.listing_type_id).toBe("gold_special");
    expect(result.payloadPreview.condition).toBe("used");
    expect(result.payloadPreview.location).toEqual({
      state: { name: "Santa Fe" },
      city: { name: "Rosario" }
    });
    expect(request).toHaveBeenCalledWith("/items", expect.objectContaining({ method: "POST" }));
  });

  it("returns an actionable error when category_id cannot be resolved", async () => {
    mockedPredictVehicleCategories.mockResolvedValue([]);
    const request = buildRequestMock();

    const result = await publishVehicleToMeli(
      {
        ...baseVehicle,
        meliCategoryId: null
      },
      {
        request,
        publishEnabled: true
      }
    );

    expect(result.ok).toBe(false);
    expect(result.apiCalled).toBe(false);
    expect(result.error).toBe("Vehicle category could not be resolved for MercadoLibre publish.");
    expect(result.missingFields).toContain("category_id");
    expect(request).not.toHaveBeenCalledWith("/items", expect.anything());
  });

  it("blocks publish when condition is missing", async () => {
    const request = buildRequestMock();

    const result = await publishVehicleToMeli(
      {
        ...baseVehicle,
        condition: null
      },
      {
        request,
        publishEnabled: true
      }
    );

    expect(result.ok).toBe(false);
    expect(result.apiCalled).toBe(false);
    expect(result.missingFields).toContain("condition");
    expect(result.fatalErrors).toContain("Vehicle condition is required for MercadoLibre publish.");
    expect(request).not.toHaveBeenCalledWith("/items", expect.anything());
  });

  it("stops publish when the seller has no available vehicle package quota", async () => {
    const request = buildRequestMock({
      "/users/123456/classifieds_promotion_packs": {
        ok: true,
        status: 200,
        body: [{ promotion_pack_id: "PK1", listing_type_id: "gold_special", available_listings: 0, status: "active" }]
      }
    });

    const result = await publishVehicleToMeli(baseVehicle, {
      request,
      publishEnabled: true
    });

    expect(result.ok).toBe(false);
    expect(result.apiCalled).toBe(false);
    expect(result.statusCode).toBe(409);
    expect(result.error).toBe(
      "No MercadoLibre vehicle package with available quota and valid listing type was found for this seller."
    );
    expect(request).not.toHaveBeenCalledWith("/items", expect.anything());
  });

  it("uses the listing_type_id selected from the available seller package", async () => {
    const request = buildRequestMock({
      "/users/123456/classifieds_promotion_packs": {
        ok: true,
        status: 200,
        body: [
          { promotion_pack_id: "PK2", listing_type_id: "silver", available_listings: 1, status: "active" },
          { promotion_pack_id: "PK1", listing_type_id: "gold_special", available_listings: 0, status: "active" }
        ]
      }
    });

    const result = await publishVehicleToMeli(baseVehicle, {
      request,
      publishEnabled: true
    });

    expect(result.ok).toBe(true);
    expect(result.payloadPreview.listing_type_id).toBe("silver");
  });
});
