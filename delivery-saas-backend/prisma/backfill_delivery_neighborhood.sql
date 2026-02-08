UPDATE "Order"
SET "deliveryNeighborhood" = json_extract(payload, '$.delivery.deliveryAddress.neighborhood')
WHERE "deliveryNeighborhood" IS NULL
  AND json_extract(payload, '$.delivery.deliveryAddress.neighborhood') IS NOT NULL;
