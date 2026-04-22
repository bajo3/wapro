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
  getCategoryBuyingModes: jest.fn(async () => ["classified"]),
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

import { publishVehicleToMeli, validateVehicleForMeli } from "../../../services/MercadoLibre/meliVehiclePublisher";
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
  jest.fn(async (path: string, options?: Record<string, any>) => {
    if (path in overrides) {
      return overrides[path];
    }
    if (path === "/users/me") {
      return { ok: true, status: 200, body: { id: 123456, nickname: "dealer" } };
    }
    if (path === "/users/123456/classifieds_promotion_packs") {
      return {
        ok: true,
        status: 200,
        body: [
          {
            id: "PACK-PUB-1",
            category_id: "MLA1744",
            description: "Paquete Publicacion",
            package_content: "publications",
            listing_details: [{ listing_type_id: "silver", available_listings: 100 }]
          },
          {
            id: "PACK-UP-1",
            category_id: "MLA1744",
            description: "Paquete Destacado",
            package_content: "upgrades",
            listing_details: [{ listing_type_id: "gold_special", available_listings: 10 }]
          }
        ]
      };
    }
    if (path === "/users/123456/classifieds_promotion_packs/silver?categoryId=MLA1744") {
      return {
        ok: true,
        status: 200,
        body: [
          {
            promotion_pack_id: "PK1",
            category_id: "MLA1744",
            description: "Paquete 15 Basico",
            package_content: "publications",
            status: "active",
            remaining_listings: 2,
            listing_details: [{ listing_type_id: "silver", available_listings: 2, remaining_listings: 2 }]
          }
        ]
      };
    }
    if (path === "/users/123456/classifieds_promotion_packs/gold_special?categoryId=MLA1744") {
      return {
        ok: true,
        status: 200,
        body: []
      };
    }
    if (path === "/items") {
      return { ok: true, status: 201, body: { id: "MLA123", status: "active", permalink: "https://meli/item/MLA123" } };
    }
    if (path === "/items/MLA123/description") {
      return { ok: true, status: 200, body: { plain_text: "saved" } };
    }
    return { ok: false, status: 404, body: { message: `Unhandled path ${path}` } };
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
    expect(result.payloadPreview.listing_type_id).toBe("silver");
    expect(result.payloadPreview.buying_mode).toBe("classified");
    expect(result.payloadPreview.condition).toBe("used");
    expect(result.payloadPreview.location).toEqual({
      state: { name: "Santa Fe" },
      city: { name: "Rosario" }
    });
    expect(request).toHaveBeenCalledWith("/items", expect.objectContaining({ method: "POST" }));
    expect(request).toHaveBeenCalledWith("/users/123456/classifieds_promotion_packs", expect.objectContaining({ method: "GET" }));
    expect(request).toHaveBeenCalledWith(
      "/users/123456/classifieds_promotion_packs/silver?categoryId=MLA1744",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("returns an actionable error when category_id cannot be resolved and vehicle hints are missing", async () => {
    mockedPredictVehicleCategories.mockResolvedValue([]);
    const request = buildRequestMock();

    const result = await publishVehicleToMeli(
      {
        ...baseVehicle,
        title: "",
        brand: "",
        model: "",
        version: "",
        meliCategoryId: null,
        meliDomainId: null
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

  it("resolves preflight required fields for an incomplete vehicle before validation", async () => {
    const request = buildRequestMock();

    const result = await validateVehicleForMeli(
      {
        ...baseVehicle,
        id: "vehicle-preflight-missing-fields",
        meliCategoryId: null,
        meliDomainId: "MLA-CARS_AND_VANS",
        condition: null,
        meliListingTypeId: null,
        km: null
      },
      { request }
    );

    expect(result.ok).toBe(true);
    expect(result.missingFields).toEqual([]);
    expect(result.payloadPreview.category_id).toBe("MLA1744");
    expect(result.payloadPreview.condition).toBe("used");
    expect(result.payloadPreview.listing_type_id).toBe("silver");
    expect(result.payloadPreview.buying_mode).toBe("classified");
  });

  it("defaults missing condition to used for vehicle preflight", async () => {
    const request = buildRequestMock();

    const result = await publishVehicleToMeli(
      {
        ...baseVehicle,
        condition: null,
        km: null
      },
      {
        request,
        publishEnabled: true
      }
    );

    expect(result.ok).toBe(true);
    expect(result.payloadPreview.condition).toBe("used");
    expect(result.missingFields).toEqual([]);
  });

  it("stops publish when the seller has no available vehicle package quota", async () => {
    const request = buildRequestMock({
      "/users/123456/classifieds_promotion_packs?package_content=ALL": {
        ok: true,
        status: 200,
        body: [
          {
            promotion_pack_id: "PK1",
            category_id: "MLA1744",
            description: "Paquete 15 Basico",
            package_content: "publications",
            status: "active",
            remaining_listings: 0,
            listing_details: [{ listing_type_id: "silver", available_listings: 0, remaining_listings: 0 }]
          }
        ]
      },
      "/users/123456/classifieds_promotion_packs": {
        ok: true,
        status: 200,
        body: [
          {
            promotion_pack_id: "PK1",
            category_id: "MLA1744",
            description: "Paquete 15 Basico",
            package_content: "publications",
            status: "active",
            remaining_listings: 0,
            listing_details: [{ listing_type_id: "silver", available_listings: 0, remaining_listings: 0 }]
          }
        ]
      },
      "/users/123456/classifieds_promotion_packs/silver?categoryId=MLA1744": {
        ok: true,
        status: 200,
        body: []
      }
    });

    const result = await publishVehicleToMeli(baseVehicle, {
      request,
      publishEnabled: true
    });

    expect(result.ok).toBe(false);
    expect(result.apiCalled).toBe(false);
    expect(result.statusCode).toBe(409);
    expect(result.error).toContain("No se pudo resolver paquete/listing_type_id");
    expect(request).not.toHaveBeenCalledWith("/items", expect.anything());
  });

  it("stops publish with clear error when the MercadoLibre seller packages endpoint returns 404", async () => {
    const request = buildRequestMock({
      "/users/123456/classifieds_promotion_packs": {
        ok: false,
        status: 404,
        body: { message: "not_found" }
      }
    });

    const result = await publishVehicleToMeli(baseVehicle, {
      request,
      publishEnabled: true
    });

    expect(result.ok).toBe(false);
    expect(result.apiCalled).toBe(false);
    expect(result.statusCode).toBe(404);
    expect(result.error).toBe("No se encontró endpoint/paquete de publicación ML para este vendedor/categoría");
    expect(request).not.toHaveBeenCalledWith("/items", expect.anything());
  });

  it("uses the listing_type_id selected from the real seller package instead of the old fallback", async () => {
    const requestBodies: Record<string, any>[] = [];
    const baseRequest = buildRequestMock({
      "/users/123456/classifieds_promotion_packs?package_content=ALL": {
        ok: true,
        status: 200,
        body: [
          {
            promotion_pack_id: "PK-UPGRADE",
            category_id: "MLA1744",
            description: "Pack Destacado",
            package_content: "upgrades",
            status: "active",
            remaining_listings: 5,
            listing_details: [{ listing_type_id: "gold_special", available_listings: 5, remaining_listings: 5 }]
          },
          {
            promotion_pack_id: "PK-PUBLICATION",
            category_id: "MLA1744",
            description: "Pack Publicacion",
            package_content: "publications",
            status: "active",
            remaining_listings: 1,
            listing_details: [{ listing_type_id: "silver", available_listings: 1, remaining_listings: 1 }]
          }
        ]
      },
      "/users/123456/classifieds_promotion_packs": {
        ok: true,
        status: 200,
        body: [
          {
            promotion_pack_id: "PK-UPGRADE",
            category_id: "MLA1744",
            description: "Pack Destacado",
            package_content: "upgrades",
            status: "active",
            remaining_listings: 5,
            listing_details: [{ listing_type_id: "gold_special", available_listings: 5, remaining_listings: 5 }]
          },
          {
            promotion_pack_id: "PK-PUBLICATION",
            category_id: "MLA1744",
            description: "Pack Publicacion",
            package_content: "publications",
            status: "active",
            remaining_listings: 1,
            listing_details: [{ listing_type_id: "silver", available_listings: 1, remaining_listings: 1 }]
          }
        ]
      },
      "/users/123456/classifieds_promotion_packs/silver?categoryId=MLA1744": {
        ok: true,
        status: 200,
        body: [
          {
            promotion_pack_id: "PK-PUBLICATION",
            category_id: "MLA1744",
            description: "Pack Publicacion",
            package_content: "publications",
            status: "active",
            remaining_listings: 1,
            listing_details: [{ listing_type_id: "silver", available_listings: 1, remaining_listings: 1 }]
          }
        ]
      },
      "/items": {
        ok: true,
        status: 201,
        body: { id: "MLA123", status: "active", permalink: "https://meli/item/MLA123" }
      }
    });
    const request = jest.fn(async (path: string, options?: Record<string, any>) => {
      if (path === "/items" && options?.body) {
        requestBodies.push(JSON.parse(String(options.body)));
      }
      return baseRequest(path, options);
    });

    const result = await publishVehicleToMeli(baseVehicle, {
      request,
      publishEnabled: true
    });

    expect(result.ok).toBe(true);
    expect(result.payloadPreview.listing_type_id).toBe("silver");
    expect(result.payloadPreview.buying_mode).toBe("classified");
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0].listing_type_id).toBe("silver");
    expect(requestBodies[0].buying_mode).toBe("classified");
  });

  it("never leaves default_buy_it_now for vehicle payloads with valid package resolution", async () => {
    const request = buildRequestMock();

    const result = await validateVehicleForMeli(baseVehicle, { request });

    expect(result.ok).toBe(true);
    expect(result.payloadPreview.buying_mode).toBe("classified");
    expect(result.payloadPreview.buying_mode).not.toBe("buy_it_now");
  });
});
