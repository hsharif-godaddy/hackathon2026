src/server/api/products/GET.ts [130 lines]
     1|import type { Request, Response } from 'express';
     2|
     3|export interface Product {
     4|  id: string;
     5|  name: string;
     6|  category: 'pottery' | 'textiles' | 'woodwork' | 'jewelry';
     7|  price: number;
     8|  image: string;
     9|  description: string;
    10|  featured?: boolean;
    11|}
    12|
    13|const products: Product[] = [
    14|  // Pottery
    15|  {
    16|    id: 'p1',
    17|    name: 'Terracotta Serving Bowl',
    18|    category: 'pottery',
    19|    price: 68,
    20|    image: '/airo-assets/images/products/pottery-hero',
    21|    description: 'Hand-thrown on the wheel from local red clay, this generous serving bowl is finished with a warm matte glaze.',
    22|    featured: true,
    23|  },
    24|  {
    25|    id: 'p2',
    26|    name: 'Speckled Mug Set',
    27|    category: 'pottery',
    28|    price: 54,
    29|    image: '/airo-assets/images/products/pottery-hero',
    30|    description: 'A set of two wheel-thrown mugs with a speckled ash glaze. Each piece is unique.',
    31|  },
    32|  {
    33|    id: 'p3',
    34|    name: 'Sage Bud Vase',
    35|    category: 'pottery',
    36|    price: 38,
    37|    image: '/airo-assets/images/products/pottery-hero',
    38|    description: 'A slender bud vase in a soft sage glaze, perfect for a single stem or small wildflower bouquet.',
    39|  },
    40|  // Textiles
    41|  {
    42|    id: 't1',
    43|    name: 'Linen Throw Blanket',
    44|    category: 'textiles',
    45|    price: 124,
    46|    image: '/airo-assets/images/products/textiles-hero',
    47|    description: 'Hand-loomed from 100% natural linen, this lightweight throw adds warmth and texture to any space.',
    48|    featured: true,
    49|  },
    50|  {
    51|    id: 't2',
    52|    name: 'Woven Table Runner',
    53|    category: 'textiles',
    54|    price: 58,
    55|    image: '/airo-assets/images/products/textiles-hero',
    56|    description: 'A hand-woven table runner in natural cotton and linen blend with subtle stripe detail.',
    57|  },
    58|  {
    59|    id: 't3',
    60|    name: 'Indigo Dyed Napkins',
    61|    category: 'textiles',
    62|    price: 42,
    63|    image: '/airo-assets/images/products/textiles-hero',
    64|    description: 'Set of four napkins naturally dyed with indigo. Each piece carries its own unique variation.',
    65|  },
    66|  // Woodwork
    67|  {
    68|    id: 'w1',
    69|    name: 'Walnut Serving Board',
    70|    category: 'woodwork',
    71|    price: 96,
    72|    image: '/airo-assets/images/products/woodwork-hero',
    73|    description: 'Hand-carved from a single piece of black walnut, this serving board is finished with food-safe oil.',
    74|    featured: true,
    75|  },
    76|  {
    77|    id: 'w2',
    78|    name: 'Oak Salad Bowl',
    79|    category: 'woodwork',
    80|    price: 112,
    81|    image: '/airo-assets/images/products/woodwork-hero',
    82|    description: 'Turned on the lathe from solid white oak, this salad bowl has a smooth, tactile finish.',
    83|  },
    84|  {
    85|    id: 'w3',
    86|    name: 'Cedar Candle Holder',
    87|    category: 'woodwork',
    88|    price: 34,
    89|    image: '/airo-assets/images/products/woodwork-hero',
    90|    description: 'A simple, elegant candle holder turned from aromatic cedar. Fits standard taper candles.',
    91|  },
    92|  // Jewelry
    93|  {
    94|    id: 'j1',
    95|    name: 'River Stone Pendant',
    96|    category: 'jewelry',
    97|    price: 78,
    98|    image: '/airo-assets/images/products/jewelry-hero',
    99|    description: 'A smooth river stone wrapped in sterling silver wire, hung on a delicate 18" chain.',
   100|    featured: true,
   101|  },
   102|  {
   103|    id: 'j2',
   104|    name: 'Hammered Brass Cuffs',
   105|    category: 'jewelry',
   106|    price: 62,
   107|    image: '/airo-assets/images/products/jewelry-hero',
   108|    description: 'Hand-hammered brass cuffs with a warm, antiqued finish. Sold as a pair.',
   109|  },
   110|  {
   111|    id: 'j3',
   112|    name: 'Ceramic Bead Necklace',
   113|    category: 'jewelry',
   114|    price: 88,
   115|    image: '/airo-assets/images/products/jewelry-hero',
   116|    description: 'Hand-rolled ceramic beads in earthy tones, strung on waxed linen cord with a brass clasp.',
   117|  },
   118|];
   119|
   120|export default function handler(req: Request, res: Response) {
   121|  const { category } = req.query;
   122|
   123|  let filtered = products;
   124|  if (category && category !== 'all') {
   125|    filtered = products.filter((p) => p.category === category);
   126|  }
   127|
   128|  res.json(filtered);
   129|}
   130|