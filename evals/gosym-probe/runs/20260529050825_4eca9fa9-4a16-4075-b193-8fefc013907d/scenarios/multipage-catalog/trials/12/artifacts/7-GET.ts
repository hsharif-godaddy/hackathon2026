src/server/api/products/GET.ts [125 lines]
     1|import type { Request, Response } from 'express';
     2|
     3|export interface Product {
     4|  id: string;
     5|  name: string;
     6|  category: 'pottery' | 'textiles' | 'woodwork' | 'jewelry';
     7|  price: number;
     8|  description: string;
     9|  imageUrl: string;
    10|}
    11|
    12|const products: Product[] = [
    13|  // Pottery
    14|  {
    15|    id: 'p1',
    16|    name: 'Rustic Stoneware Bowl',
    17|    category: 'pottery',
    18|    price: 48,
    19|    description: 'Hand-thrown stoneware bowl with a warm terracotta glaze. Perfect for everyday use.',
    20|    imageUrl: '/airo-assets/images/products/pottery-1',
    21|  },
    22|  {
    23|    id: 'p2',
    24|    name: 'Artisan Ceramic Mug',
    25|    category: 'pottery',
    26|    price: 32,
    27|    description: 'A sturdy, hand-crafted mug with a natural clay finish and comfortable handle.',
    28|    imageUrl: '/airo-assets/images/products/pottery-2',
    29|  },
    30|  {
    31|    id: 'p3',
    32|    name: 'Sculptural Clay Vase',
    33|    category: 'pottery',
    34|    price: 75,
    35|    description: 'An expressive vase shaped by hand, with organic curves and a matte earth glaze.',
    36|    imageUrl: '/airo-assets/images/products/pottery-3',
    37|  },
    38|  // Textiles
    39|  {
    40|    id: 't1',
    41|    name: 'Woven Wool Throw',
    42|    category: 'textiles',
    43|    price: 120,
    44|    description: 'A hand-loomed wool throw in warm natural tones. Soft, durable, and timeless.',
    45|    imageUrl: '/airo-assets/images/products/textiles-1',
    46|  },
    47|  {
    48|    id: 't2',
    49|    name: 'Natural Fiber Basket',
    50|    category: 'textiles',
    51|    price: 58,
    52|    description: 'Handwoven from sustainably sourced natural fibers. Functional and beautifully crafted.',
    53|    imageUrl: '/airo-assets/images/products/textiles-2',
    54|  },
    55|  {
    56|    id: 't3',
    57|    name: 'Macramé Wall Hanging',
    58|    category: 'textiles',
    59|    price: 85,
    60|    description: 'A statement wall piece hand-knotted from organic cotton rope. Each one is unique.',
    61|    imageUrl: '/airo-assets/images/products/textiles-3',
    62|  },
    63|  // Woodwork
    64|  {
    65|    id: 'w1',
    66|    name: 'Walnut Cutting Board',
    67|    category: 'woodwork',
    68|    price: 95,
    69|    description: 'Hand-finished walnut cutting board with natural grain patterns. A kitchen heirloom.',
    70|    imageUrl: '/airo-assets/images/products/woodwork-1',
    71|  },
    72|  {
    73|    id: 'w2',
    74|    name: 'Turned Wooden Bowl',
    75|    category: 'woodwork',
    76|    price: 110,
    77|    description: 'Lathe-turned from a single piece of reclaimed hardwood. Smooth, warm, and lasting.',
    78|    imageUrl: '/airo-assets/images/products/woodwork-2',
    79|  },
    80|  {
    81|    id: 'w3',
    82|    name: 'Floating Wall Shelf',
    83|    category: 'woodwork',
    84|    price: 145,
    85|    description: 'Minimalist wall shelf hand-crafted from solid oak. Clean lines, natural finish.',
    86|    imageUrl: '/airo-assets/images/products/woodwork-3',
    87|  },
    88|  // Jewelry
    89|  {
    90|    id: 'j1',
    91|    name: 'Sterling Silver Ring',
    92|    category: 'jewelry',
    93|    price: 68,
    94|    description: 'Hand-forged sterling silver ring with a hammered texture. Timeless and wearable.',
    95|    imageUrl: '/airo-assets/images/products/jewelry-1',
    96|  },
    97|  {
    98|    id: 'j2',
    99|    name: 'Brass Drop Earrings',
   100|    category: 'jewelry',
   101|    price: 42,
   102|    description: 'Handcrafted brass earrings with a warm patina. Lightweight and elegant.',
   103|    imageUrl: '/airo-assets/images/products/jewelry-2',
   104|  },
   105|  {
   106|    id: 'j3',
   107|    name: 'Moonstone Pendant',
   108|    category: 'jewelry',
   109|    price: 88,
   110|    description: 'A hand-set moonstone pendant on a delicate sterling chain. Ethereal and unique.',
   111|    imageUrl: '/airo-assets/images/products/jewelry-3',
   112|  },
   113|];
   114|
   115|export default function handler(req: Request, res: Response) {
   116|  const { category } = req.query;
   117|
   118|  let filtered = products;
   119|  if (category && typeof category === 'string' && category !== 'all') {
   120|    filtered = products.filter((p) => p.category === category.toLowerCase());
   121|  }
   122|
   123|  res.json(filtered);
   124|}
   125|