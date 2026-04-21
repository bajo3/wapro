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
  it("forces classified for vehicle categories even when input is gold_special", async () => {
    const result = await buildMeliVehiclePayload({
      ...baseVehicle,
      pictures: ["https://img.test/1.jpg"]
    });

    expect(result.originalListingTypeId).toBe("gold_special");
    expect(result.finalListingTypeId).toBe("classified");
    expect(result.payload.listing_type_id).toBe("classified");
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
