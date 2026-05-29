src/pages/products.tsx [70-94 of 202] (truncated — use startLine/numLines to read remaining)
    70|  const [searchParams, setSearchParams] = useSearchParams();
    71|  const initialCategory = (searchParams.get('category') as Category) ?? 'all';
    72|
    73|  const [activeCategory, setActiveCategory] = useState<Category>(initialCategory);
    74|  const [products, setProducts] = useState<Product[]>([]);
    75|  const [loading, setLoading] = useState(true);
    76|
    77|  const fetchProducts = useCallback(async (category: Category) => {
    78|    setLoading(true);
    79|    try {
    80|      const url =
    81|        category === 'all' ? '/api/products' : `/api/products?category=${category}`;
    82|      const res = await fetch(url);
    83|      const data: Product[] = await res.json();
    84|      setProducts(data);
    85|    } catch {
    86|      setProducts([]);
    87|    } finally {
    88|      setLoading(false);
    89|    }
    90|  }, []);
    91|
    92|  useEffect(() => {
    93|    fetchProducts(activeCategory);
    94|  }, [activeCategory, fetchProducts]);