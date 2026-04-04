package search

import (
	"math"
	"testing"
)

func TestCalibrateScore(t *testing.T) {
	cal := NewCalibrator(0.5, 10.0, 0.4)

	tests := []struct {
		name      string
		rawScore  float32
		wantMin   float64
		wantMax   float64
		wantLevel string
	}{
		{"high score", 0.9, 0.95, 1.0, "high"},
		{"mid score", 0.5, 0.45, 0.55, "medium"},
		{"low score", 0.1, 0.0, 0.02, ""},
		{"zero score", 0.0, 0.0, 0.01, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			conf := cal.Calibrate(tt.rawScore)
			if float64(conf) < tt.wantMin || float64(conf) > tt.wantMax {
				t.Errorf("Calibrate(%f) = %f, want in [%f, %f]", tt.rawScore, conf, tt.wantMin, tt.wantMax)
			}
			level := cal.ConfidenceLevel(conf)
			if level != tt.wantLevel {
				t.Errorf("ConfidenceLevel(%f) = %q, want %q", conf, level, tt.wantLevel)
			}
		})
	}
}

func TestCalibrateScore_Monotonic(t *testing.T) {
	cal := NewCalibrator(0.5, 10.0, 0.4)

	prev := float32(0.0)
	for raw := float32(0.0); raw <= 1.0; raw += 0.05 {
		conf := cal.Calibrate(raw)
		if conf < prev {
			t.Errorf("non-monotonic: Calibrate(%f)=%f < Calibrate(prev)=%f", raw, conf, prev)
		}
		prev = conf
	}
}

func TestCalibrator_AboveThreshold(t *testing.T) {
	cal := NewCalibrator(0.5, 10.0, 0.4)

	if cal.AboveThreshold(0.3) {
		t.Error("expected 0.3 to be below threshold")
	}
	if !cal.AboveThreshold(0.5) {
		t.Error("expected 0.5 to be above threshold")
	}
}

func TestCalibrator_SigmoidProperties(t *testing.T) {
	cal := NewCalibrator(0.5, 10.0, 0.4)

	mid := cal.Calibrate(0.5)
	if math.Abs(float64(mid)-0.5) > 0.01 {
		t.Errorf("Calibrate(midpoint=0.5) = %f, want ~0.5", mid)
	}
}
