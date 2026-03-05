package models

import "time"

// Chunk represents a single chunk of a knowledge base document.
type Chunk struct {
	DocName           string
	SectionPath       string
	Content           string
	ContextualContent string
	ContentHash       string
	ContextualHash    string
	ChunkIndex        int
	Tags              []string
	CreatedAt         time.Time
	UpdatedAt         time.Time
	DenseVector       []float32
	SparseVector      *SparseVector
}

// SparseVector represents a BM25 sparse vector with indices and values.
type SparseVector struct {
	Indices []uint32
	Values  []float32
}

// Document represents a raw knowledge base document for ingestion.
type Document struct {
	Name    string
	Content string
	Tags    []string
}
