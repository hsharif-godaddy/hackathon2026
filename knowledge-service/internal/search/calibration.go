package search

import "math"

type Calibrator struct {
	midpoint  float64
	steepness float64
	threshold float32
}

func NewCalibrator(midpoint, steepness float32, threshold float32) *Calibrator {
	return &Calibrator{
		midpoint:  float64(midpoint),
		steepness: float64(steepness),
		threshold: threshold,
	}
}

func (c *Calibrator) Calibrate(rawScore float32) float32 {
	return float32(1.0 / (1.0 + math.Exp(-c.steepness*(float64(rawScore)-c.midpoint))))
}

func (c *Calibrator) AboveThreshold(confidence float32) bool {
	return confidence >= c.threshold
}

func (c *Calibrator) ConfidenceLevel(confidence float32) string {
	if confidence >= 0.65 {
		return "high"
	}
	if confidence >= 0.4 {
		return "medium"
	}
	if confidence >= c.threshold {
		return "low"
	}
	return ""
}
