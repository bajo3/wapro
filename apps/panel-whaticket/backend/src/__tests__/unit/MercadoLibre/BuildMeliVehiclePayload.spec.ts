jest.mock("../../../helpers/meliCategoriesService", () => ({
  getCategoryAttributes: jest.fn(async () => []),
  mapVehicleToMeliAttributes: jest.fn(() => ({
    attributes: [],
    missingRequired: [],
    missingRecommended: []
  }))
}));

jest.mock("../../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

import {
  buildMeliVehiclePayload,
  normalizeMeliVehicleMetadata,
  validateMeliVehiclePayload
} from "../../../services/MeliServices/buildMeliVehiclePayload";

const baseVehicle = {
  id: "vehicle-1",
  title: "Peugeot 207 1.4 XR",
  brand: "Peugeot",
  model: "207",
  version: "1.4 XR",
  year: 2008,
  km: 120000,
  price: "8900001",
  currency: "ARS",
  condition: "used",
  fuel: "Nafta",
  transmission: "Manual",
  color: "Gris",
  meliCategoryId: "MLA1744",
  meliListingTypeId: "gold_special",
  meliDomainId: "MLA-CARS_AND_VANS",
  meliAttributes: [],
  pictures: []
} as any;

describe("buildMeliVehiclePayload", () => {
  it("keeps the vehicle listing type when preflight has not resolved a package yet", async () => {
    const result = await buildMeliVehiclePayload({
      ...baseVehicle,
      pictures: ["https://img.test/1.jpg"]
    });

    expect(result.originalListingTypeId).toBe("gold_special");
    expect(result.finalListingTypeId).toBe("gold_special");
    expect(result.payload.listing_type_id).toBe("gold_special");
  });

  it("applies preflight overrides for category and listing type", async () => {
    const result = await buildMeliVehiclePayload({
      ...baseVehicle,
      pictures: ["https://img.test/1.jpg"]
    }, {
      resolvedCategoryId: "MLA999999",
      resolvedDomainId: "MLA-CUSTOM-DOMAIN",
      resolvedListingTypeId: "silver"
    });

    expect(result.payload.category_id).toBe("MLA999999");
    expect(result.payload.listing_type_id).toBe("silver");
    expect(result.finalListingTypeId).toBe("silver");
  });

  it("marks category missing instead of silently defaulting it", async () => {
    const result = await buildMeliVehiclePayload({
      ...baseVehicle,
      meliCategoryId: null,
      meliDomainId: null,
      pictures: ["https://img.test/1.jpg"]
    });

    expect(result.ok).toBe(false);
    expect(result.payload.category_id).toBeNull();
    expect(result.missingFields).toContain("category_id");
    expect(result.fatalErrors).toContain("Vehicle category is required for MercadoLibre publish.");
  });

  it("keeps condition missing in dry-run when vehicle condition is null", async () => {
    const result = await buildMeliVehiclePayload(
      {
        ...baseVehicle,
        condition: null,
        pictures: ["https://img.test/1.jpg"]
      },
      { dryRun: true }
    );

    expect(result.ok).toBe(false);
    expect(result.missingFields).toContain("condition");
    expect(result.fatalErrors).toEqual([]);
  });

  it("blocks publish payload when vehicle condition is missing", async () => {
    const result = await buildMeliVehiclePayload({
      ...baseVehicle,
      condition: null,
      pictures: ["https://img.test/1.jpg"]
    });

    expect(result.ok).toBe(false);
    expect(result.missingFields).toContain("condition");
    expect(result.fatalErrors).toContain("Vehicle condition is required for MercadoLibre publish.");
  });

  it("maps 0km condition to new", async () => {
    const result = await buildMeliVehiclePayload({
      ...baseVehicle,
      condition: "0km",
      pictures: ["https://img.test/1.jpg"]
    });

    expect(result.payload.condition).toBe("new");
  });

  it("normalizes pictures from string arrays and removes duplicates", async () => {
    const result = await buildMeliVehiclePayload({
      ...baseVehicle,
      pictures: [
        "https://img.test/1.jpg",
        "https://img.test/1.jpg",
        "",
        "nota-url"
      ]
    });

    expect(result.picturesRawType).toBe("array");
    expect(result.validPicturesCount).toBe(1);
    expect(result.payload.pictures).toEqual([{ source: "https://img.test/1.jpg" }]);
  });

  it("uses vehicle.images as canonical WaPro photo source", async () => {
    const result = await buildMeliVehiclePayload({
      ...baseVehicle,
      images: Array.from({ length: 25 }, (_, index) => `https://img.test/${index + 1}.jpg`),
      pictures: "[]"
    });

    expect(result.validPicturesCount).toBe(25);
    expect(result.payload.pictures).toHaveLength(25);
    expect(result.payload.pictures[0]).toEqual({ source: "https://img.test/1.jpg" });
  });

  it("falls back to vehicle.pictures only when images is empty", async () => {
    const result = await buildMeliVehiclePayload({
      ...baseVehicle,
      images: "[]",
      pictures: JSON.stringify([{ url: "https://img.test/fallback.jpg" }])
    });

    expect(result.validPicturesCount).toBe(1);
    expect(result.payload.pictures).toEqual([{ source: "https://img.test/fallback.jpg" }]);
  });

  it("normalizes pictures from object arrays", async () => {
    const result = await buildMeliVehiclePayload({
      ...baseVehicle,
      pictures: [
        { url: "https://img.test/1.jpg" },
        { secure_url: "https://img.test/2.jpg" },
        { src: "https://img.test/3.jpg" }
      ]
    });

    expect(result.validPicturesCount).toBe(3);
    expect(result.payload.pictures).toEqual([
      { source: "https://img.test/1.jpg" },
      { source: "https://img.test/2.jpg" },
      { source: "https://img.test/3.jpg" }
    ]);
  });

  it("normalizes pictures from JSON string", async () => {
    const result = await buildMeliVehiclePayload({
      ...baseVehicle,
      pictures: JSON.stringify([{ url: "https://img.test/json.jpg" }])
    });

    expect(result.validPicturesCount).toBe(1);
    expect(result.payload.pictures).toEqual([{ source: "https://img.test/json.jpg" }]);
  });

  it("keeps dry-run inspectable when pictures are missing", async () => {
    const result = await buildMeliVehiclePayload(
      {
        ...baseVehicle,
        pictures: []
      },
      { dryRun: true }
    );

    expect(result.warnings).toContain("pictures");
    expect(result.fatalErrors).toEqual([]);
    expect(result.payload.pictures).toBeUndefined();
  });

  it("blocks publish payload when pictures are missing", async () => {
    const result = await buildMeliVehiclePayload({
      ...baseVehicle,
      pictures: []
    });

    expect(result.ok).toBe(false);
    expect(result.missingFields).toContain("pictures");
    expect(result.fatalErrors).toContain("Vehicle has no valid pictures for MercadoLibre publish.");
  });

  it("builds a safe generated description when vehicle.description is missing", async () => {
    const result = await buildMeliVehiclePayload({
      ...baseVehicle,
      title: null,
      description: null,
      pictures: ["https://img.test/1.jpg"]
    });

    expect(result.descriptionPlainText).toContain("Peugeot 207 1.4 XR 2008");
    expect(result.descriptionPlainText).toContain("Kilometraje: 120000 km");
    expect(result.descriptionPlainText).toContain("Precio: 8900001 ARS");
  });

  it("requires a description for publish when generation is not possible", async () => {
    const result = await buildMeliVehiclePayload({
      ...baseVehicle,
      title: null,
      brand: null,
      model: null,
      version: null,
      year: null,
      km: null,
      fuel: null,
      transmission: null,
      color: null,
      price: null,
      currency: null,
      description: null,
      pictures: ["https://img.test/1.jpg"]
    });

    expect(result.ok).toBe(false);
    expect(result.missingFields).toContain("description");
    expect(result.fatalErrors).toContain("Vehicle description is required for MercadoLibre publish.");
  });
});

describe("validateMeliVehiclePayload", () => {
  it("returns fatalErrors for publish without valid pictures", () => {
    const validation = validateMeliVehiclePayload(
      {
        title: "Peugeot 207",
        category_id: "MLA1744",
        price: 8900001,
        currency_id: "ARS",
        available_quantity: 1,
        buying_mode: "buy_it_now",
        listing_type_id: "classified",
        condition: "used",
        attributes: []
      },
      {
        dryRun: false,
        validPicturesCount: 0,
        descriptionPlainText: "desc"
      }
    );

    expect(validation.ok).toBe(false);
    expect(validation.fatalErrors).toEqual(["Vehicle has no valid pictures for MercadoLibre publish."]);
  });
});

describe("normalizeMeliVehicleMetadata", () => {
  it("returns missing metadata instead of hardcoded defaults", () => {
    const metadata = normalizeMeliVehicleMetadata({
      ...baseVehicle,
      meliCategoryId: null,
      meliDomainId: null
    } as any);

    expect(metadata.categoryId).toBeNull();
    expect(metadata.domainId).toBeNull();
    expect(metadata.categorySource).toBe("missing_vehicle_category");
    expect(metadata.domainSource).toBe("missing_vehicle_domain");
  });
});
