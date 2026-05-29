src/server/api/products/GET.ts [143 lines]
     1|import type { Request, Response } from 'express';
     2|
     3|export interface Product {
     4|  id: string;
     5|  name: string;
     6|  category: 'pottery' | 'textiles' | 'woodwork' | 'jewelry';
     7|  price: number;
     8|  description: string;
     9|  featured: boolean;
    10|  imageSlot: string;
    11|}
    12|
    13|const products: Product[] = [
    14|  // Pottery
    15|  {
    16|    id: 'p1',
    17|    name: 'Terracotta Serving Bowl',
    18|    category: 'pottery',
    19|    price: 68,
    20|    description: 'Hand-thrown on the wheel from local red clay. Each piece is unique, with subtle variations in glaze.',
    21|    featured: true,
    22|    imageSlot: 'products/pottery-hero',
    23|  },
    24|  {
    25|    id: 'p2',
    26|    name: 'Speckled Mug Set',
    27|    category: 'pottery',
    28|    price: 54,
    29|    description: 'A set of two wheel-thrown mugs with a warm speckled glaze. Dishwasher safe.',
    30|    featured: false,
    31|    imageSlot: 'products/pottery-hero',
    32|  },
    33|  {
    34|    id: 'p3',
    35|    name: 'Stoneware Vase',
    36|    category: 'pottery',
    37|    price: 92,
    38|    description: 'Tall, elegant stoneware vase with a matte ash glaze. Perfect for dried botanicals.',
    39|    featured: false,
    40|    imageSlot: 'products/pottery-hero',
    41|  },
    42|  // Textiles
    43|  {
    44|    id: 't1',
    45|    name: 'Hand-Woven Throw Blanket',
    46|    category: 'textiles',
    47|    price: 145,
    48|    description: 'Woven on a floor loom using 100% organic cotton in warm earth tones. Generously sized.',
    49|    featured: true,
    50|    imageSlot: 'products/textiles-hero',
    51|  },
    52|  {
    53|    id: 't2',
    54|    name: 'Linen Table Runner',
    55|    category: 'textiles',
    56|    price: 48,
    57|    description: 'Naturally dyed linen runner with hand-knotted fringe ends. Adds warmth to any table.',
    58|    featured: false,
    59|    imageSlot: 'products/textiles-hero',
    60|  },
    61|  {
    62|    id: 't3',
    63|    name: 'Macramé Wall Hanging',
    64|    category: 'textiles',
    65|    price: 78,
    66|    description: 'Intricate knotted wall art made from unbleached cotton rope. Each piece is one-of-a-kind.',
    67|    featured: false,
    68|    imageSlot: 'products/textiles-hero',
    69|  },
    70|  // Woodwork
    71|  {
    72|    id: 'w1',
    73|    name: 'Live-Edge Serving Board',
    74|    category: 'woodwork',
    75|    price: 115,
    76|    description: 'Hand-planed walnut board with natural live edge. Finished with food-safe beeswax oil.',
    77|    featured: true,
    78|    imageSlot: 'products/woodwork-hero',
    79|  },
    80|  {
    81|    id: 'w2',
    82|    name: 'Turned Wooden Bowl',
    83|    category: 'woodwork',
    84|    price: 88,
    85|    description: 'Lathe-turned from a single piece of cherry wood. The grain pattern is truly stunning.',
    86|    featured: false,
    87|    imageSlot: 'products/woodwork-hero',
    88|  },
    89|  {
    90|    id: 'w3',
    91|    name: 'Carved Spoon Set',
    92|    category: 'woodwork',
    93|    price: 42,
    94|    description: 'Set of three hand-carved cooking spoons in maple. Smooth, ergonomic, and beautiful.',
    95|    featured: false,
    96|    imageSlot: 'products/woodwork-hero',
    97|  },
    98|  // Jewelry
    99|  {
   100|    id: 'j1',
   101|    name: 'Hammered Silver Cuff',
   102|    category: 'jewelry',
   103|    price: 135,
   104|    description: 'Sterling silver cuff bracelet with a hand-hammered texture. Adjustable to fit most wrists.',
   105|    featured: true,
   106|    imageSlot: 'products/jewelry-hero',
   107|  },
   108|  {
   109|    id: 'j2',
   110|    name: 'Ceramic Bead Necklace',
   111|    category: 'jewelry',
   112|    price: 62,
   113|    description: 'Handmade ceramic beads in muted earth tones, strung on waxed linen cord.',
   114|    featured: false,
   115|    imageSlot: 'products/jewelry-hero',
   116|  },
   117|  {
   118|    id: 'j3',
   119|    name: 'Forged Copper Earrings',
   120|    category: 'jewelry',
   121|    price: 48,
   122|    description: 'Lightweight forged copper drop earrings with a natural patina finish.',
   123|    featured: false,
   124|    imageSlot: 'products/jewelry-hero',
   125|  },
   126|];
   127|
   128|export default function handler(req: Request, res: Response) {
   129|  const { category, featured } = req.query;
   130|
   131|  let filtered = products;
   132|
   133|  if (category && typeof category === 'string') {
   134|    filtered = filtered.filter((p) => p.category === category.toLowerCase());
   135|  }
   136|
   137|  if (featured === 'true') {
   138|    filtered = filtered.filter((p) => p.featured);
   139|  }
   140|
   141|  res.json(filtered);
   142|}
   143|