package marketdata

import "time"

type PriceTickV1 struct {
	Symbol    string    `json:"symbol"`
	Price     float64   `json:"price"`
	Source    string    `json:"source"`
	Timestamp time.Time `json:"timestamp"`
}

type PriceTickBatch struct {
	Ticks []PriceTickV1 `json:"ticks"`
}
