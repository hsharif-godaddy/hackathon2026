src/server/api/products/GET.ts [146 lines]
     1|import type { Request, Response } from 'express';
     2|
     3|export interface Product {
     4|  id: string;
     5|  name: string;
     6|  category: 'pottery' | 'textiles' | 'woodwork' | 'jewelry';
     7|  price: number;
     8|  description: string;
     9|  imageUrl: string;
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
    20|    description: 'Hand-thrown on the wheel and finished with a warm terracotta glaze. Perfect for salads, fruit, or as a centerpiece.',
    21|    imageUrl: '/airo-assets/images/products/pottery-bowl',
    22|    featured: true,
    23|  },
    24|  {
    25|    id: 'p2',
    26|    name: 'Speckled Mug Set',
    27|    category: 'pottery',
    28|    price: 54,
    29|    description: 'A set of two hand-thrown mugs with a speckled ash glaze. Each piece is unique, made to be held and loved.',
    30|    imageUrl: '/airo-assets/images/products/pottery-bowl',
    31|    featured: false,
    32|  },
    33|  {
    34|    id: 'p3',
    35|    name: 'Stoneware Vase',
    36|    category: 'pottery',
    37|    price: 82,
    38|    description: 'Tall, elegant stoneware vase with a matte cream exterior and warm amber interior glaze.',
    39|    imageUrl: '/airo-assets/images/products/pottery-bowl',
    40|    featured: false,
    41|  },
    42|  // Textiles
    43|  {
    44|    id: 't1',
    45|    name: 'Linen Throw Blanket',
    46|    category: 'textiles',
    47|    price: 124,
    48|    description: 'Handwoven from 100% natural linen in a herringbone pattern. Softens beautifully with every wash.',
    49|    imageUrl: '/airo-assets/images/products/textile-throw',
    50|    featured: true,
    51|  },
    52|  {
    53|    id: 't2',
    54|    name: 'Wool Table Runner',
    55|    category: 'textiles',
    56|    price: 78,
    57|    description: 'Hand-dyed with natural plant pigments, this wool table runner brings warmth to any dining table.',
    58|    imageUrl: '/airo-assets/images/products/textile-throw',
    59|    featured: false,
    60|  },
    61|  {
    62|    id: 't3',
    63|    name: 'Cotton Tote Bag',
    64|    category: 'textiles',
    65|    price: 42,
    66|    description: 'Sturdy hand-stitched cotton tote with a block-printed botanical motif. Durable and beautiful.',
    67|    imageUrl: '/airo-assets/images/products/textile-throw',
    68|    featured: false,
    69|  },
    70|  // Woodwork
    71|  {
    72|    id: 'w1',
    73|    name: 'Walnut Serving Board',
    74|    category: 'woodwork',
    75|    price: 96,
    76|    description: 'Hand-carved from a single piece of black walnut. The natural grain makes every board one of a kind.',
    77|    imageUrl: '/airo-assets/images/products/woodwork-bowl',
    78|    featured: true,
    79|  },
    80|  {
    81|    id: 'w2',
    82|    name: 'Oak Salad Bowl',
    83|    category: 'woodwork',
    84|    price: 112,
    85|    description: 'Turned on a lathe from sustainably sourced white oak. Finished with food-safe beeswax oil.',
    86|    imageUrl: '/airo-assets/images/products/woodwork-bowl',
    87|    featured: false,
    88|  },
    89|  {
    90|    id: 'w3',
    91|    name: 'Maple Spoon Set',
    92|    category: 'woodwork',
    93|    price: 58,
    94|    description: 'A set of three hand-carved maple spoons in varying sizes. Smooth, ergonomic, and built to last.',
    95|    imageUrl: '/airo-assets/images/products/woodwork-bowl',
    96|    featured: false,
    97|  },
    98|  // Jewelry
    99|  {
   100|    id: 'j1',
   101|    name: 'Hammered Silver Ring',
   102|    category: 'jewelry',
   103|    price: 88,
   104|    description: 'Hand-forged sterling silver ring with a hammered texture. Available in sizes 5–10.',
   105|    imageUrl: '/airo-assets/images/products/jewelry-ring',
   106|    featured: true,
   107|  },
   108|  {
   109|    id: 'j2',
   110|    name: 'Labradorite Pendant',
   111|    category: 'jewelry',
   112|    price: 135,
   113|    description: 'A raw labradorite stone wrapped in hand-twisted copper wire. Each stone has its own unique flash.',
   114|    imageUrl: '/airo-assets/images/products/jewelry-ring',
   115|    featured: false,
   116|  },
   117|  {
   118|    id: 'j3',
   119|    name: 'Brass Hoop Earrings',
   120|    category: 'jewelry',
   121|    price: 62,
   122|    description: 'Hand-formed brass hoops with a brushed matte finish. Lightweight and comfortable for all-day wear.',
   123|    imageUrl: '/airo-assets/images/products/jewelry-ring',
   124|    featured: false,
   125|  },
   126|];
   127|
   128|export default function handler(req: Request, res: Response) {
   129|  const { category, featured } = req.query;
   130|
   131|  let result = [...products];
   132|
   133|  if (category && typeof category === 'string') {
   134|    const validCategories = ['pottery', 'textiles', 'woodwork', 'jewelry'];
   135|    if (validCategories.includes(category)) {
   136|      result = result.filter((p) => p.category === category);
   137|    }
   138|  }
   139|
   140|  if (featured === 'true') {
   141|    result = result.filter((p) => p.featured === true);
   142|  }
   143|
   144|  res.json(result);
   145|}
   146|