import type { SemanticAssetInput } from "@arciin/shared"

/**
 * A controlled library for calibrating and testing semantic search: opaque
 * camera-style file names, meaning carried only by captions and metadata.
 * `topic` is the ground truth a query is expected to find.
 */
export type CorpusItem = SemanticAssetInput & { key: string; topic: string }

const img = (key: string, topic: string, caption: string): CorpusItem => ({
  key,
  topic,
  originalFilename: `${key}.jpg`,
  mediaType: "IMAGE",
  libraryName: "Images",
  caption,
})

export const SEMANTIC_CORPUS: CorpusItem[] = [
  img("IMG_0042", "birthday", "A birthday party indoors: several friends gathered around a cake while a person blows out the lit candles."),
  img("IMG_0107", "birthday", "Children wearing party hats sit at a table with balloons and a decorated birthday cake."),
  img("IMG_0233", "beach", "A beach at sunset with orange sky reflected on calm waves and a silhouette of palm trees."),
  img("IMG_0234", "beach", "People walking along a sandy shoreline in the evening as the sun sets over the ocean."),
  img("DSC_1180", "graduation", "Students in black caps and gowns throw their mortarboards in the air outside a university building."),
  img("DSC_1181", "graduation", "A smiling graduate holds a diploma next to her parents at a commencement ceremony."),
  img("PXL_2201", "car", "A red sports car parked on a city street at night with its headlights on."),
  img("PXL_2202", "car", "A mechanic works under the open hood of a silver sedan in a garage."),
  img("IMG_0510", "dog", "A golden retriever catches a frisbee in a grassy park on a sunny day."),
  img("IMG_0788", "food", "A bowl of ramen with a soft-boiled egg, green onions and slices of pork on a wooden table."),
  img("IMG_0901", "mountains", "Snow-capped mountain peaks above a pine forest and a clear alpine lake."),
  img("IMG_0955", "office", "A laptop, a coffee mug and a notebook on a desk in a bright home office."),
  {
    key: "scan_0003",
    topic: "invoice",
    originalFilename: "scan_0003.pdf",
    mediaType: "DOCUMENT",
    libraryName: "Documents",
    documentSubject: "Invoice",
    documentInsight: {
      summary: "An invoice from a web hosting company billing for three months of server hosting, with a total amount due and payment terms of 30 days.",
      keywords: ["invoice", "billing", "payment due", "hosting"],
      topics: ["finance", "billing"],
    },
  },
  {
    key: "doc_2231",
    topic: "invoice",
    originalFilename: "doc_2231.pdf",
    mediaType: "DOCUMENT",
    libraryName: "Documents",
    documentInsight: {
      summary: "A receipt and bill for office supplies listing items, tax and the amount paid by card.",
      keywords: ["receipt", "bill", "amount paid"],
      topics: ["expenses"],
    },
  },
  {
    key: "scan_0011",
    topic: "lease",
    originalFilename: "scan_0011.pdf",
    mediaType: "DOCUMENT",
    libraryName: "Documents",
    documentInsight: {
      summary: "A residential lease agreement between a landlord and tenant covering rent, deposit and a twelve month term.",
      keywords: ["lease", "rent", "tenant", "landlord"],
      topics: ["housing", "legal"],
    },
  },
  {
    key: "VID_20260412",
    topic: "wedding",
    originalFilename: "VID_20260412.mp4",
    mediaType: "VIDEO",
    libraryName: "Videos",
    durationSeconds: 312,
    caption: "A bride and groom share their first dance in a decorated hall while guests watch.",
  },
  {
    key: "VID_20260501",
    topic: "cooking",
    originalFilename: "VID_20260501.mp4",
    mediaType: "VIDEO",
    libraryName: "Videos",
    durationSeconds: 640,
    title: "Sourdough weekend",
    description: "Kneading, shaping and baking a loaf of sourdough bread at home.",
  },
  {
    key: "AUD_0012",
    topic: "podcast",
    originalFilename: "AUD_0012.m4a",
    mediaType: "AUDIO",
    libraryName: "Music",
    durationSeconds: 2700,
    transcriptText: "Welcome back to the show. Today we talk about budgeting, saving money and paying off debt.",
  },
]

/** Queries and the topic each should find. `null` means nothing in the corpus should match. */
export const SEMANTIC_QUERIES: Array<{ query: string; topic: string | null }> = [
  { query: "birthday party", topic: "birthday" },
  { query: "people blowing out candles", topic: "birthday" },
  { query: "cake celebration", topic: "birthday" },
  { query: "beach sunset", topic: "beach" },
  { query: "ocean at dusk", topic: "beach" },
  { query: "graduation", topic: "graduation" },
  { query: "car", topic: "car" },
  { query: "invoice", topic: "invoice" },
  { query: "rental contract", topic: "lease" },
  { query: "wedding dance", topic: "wedding" },
  { query: "baking bread", topic: "cooking" },
  { query: "personal finance podcast", topic: "podcast" },
  { query: "puppy playing fetch", topic: "dog" },
  { query: "quantum chromodynamics lecture", topic: null },
  { query: "tax return 1998", topic: null },
  { query: "submarine", topic: null },
]
