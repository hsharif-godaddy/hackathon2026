src/pages/products.tsx [90-129 of 202] (truncated — use startLine/numLines to read remaining)
    90|  }, []);
    91|
    92|  useEffect(() => {
    93|    fetchProducts(activeCategory);
    94|  }, [activeCategory, fetchProducts]);
    95|
    96|  // Sync URL param → state on mount
    97|  useEffect(() => {
    98|    const cat = (searchParams.get('category') as Category) ?? 'all';
    99|    setActiveCategory(cat);
   100|  }, []); // eslint-disable-line react-hooks/exhaustive-deps
   101|
   102|  const handleCategoryChange = (cat: Category) => {
   103|    setActiveCategory(cat);
   104|    if (cat === 'all') {
   105|      setSearchParams({});
   106|    } else {
   107|      setSearchParams({ category: cat });
   108|    }
   109|  };
   110|
   111|  const categoryLabel =
   112|    CATEGORIES.find((c) => c.value === activeCategory)?.label ?? 'All';
   113|
   114|  return (
   115|    <>
   116|      <Helmet>
   117|        <title>Shop — Artisan Goods Co.</title>
   118|        <meta
   119|          name="description"
   120|          content="Browse our full collection of handmade pottery, textiles, woodwork, and jewelry from independent artisans."
   121|        />
   122|      </Helmet>
   123|
   124|      {/* Page header */}
   125|      <div className="bg-muted border-b border-border">
   126|        <div className="container mx-auto px-6 py-10">
   127|          {/* Breadcrumb */}
   128|          <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4" aria-label="Breadcrumb">
   129|            <Link to="/" className="hover:text-foreground transition-colors">