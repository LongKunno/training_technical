package handlers

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"crypto_simulator/core_trading/internal/papertrading"
)

func TestParseOrderFilterClampsLimitAndKeepsFilters(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest(http.MethodGet, "/api/paper/orders?session_id=paper-session-1&symbol=BTCUSDT&side=buy&limit=999&offset=25", nil)

	filter, err := parseOrderFilter(request)
	if err != nil {
		t.Fatalf("expected filter parsing to succeed, got error: %v", err)
	}

	if filter.SessionID != "paper-session-1" || filter.Symbol != "BTCUSDT" || filter.Side != papertrading.OrderSideBuy {
		t.Fatalf("expected session, symbol and side filters to be preserved, got %+v", filter)
	}
	if filter.Limit != 200 || filter.Offset != 25 {
		t.Fatalf("expected limit to clamp to 200 and offset 25, got %+v", filter)
	}
}

func TestParseOrderFilterRejectsInvalidPaginationAndSide(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		target   string
		expected error
	}{
		{
			name:     "zero limit",
			target:   "/api/paper/orders?limit=0",
			expected: papertrading.ErrInvalidLimit,
		},
		{
			name:     "negative offset",
			target:   "/api/paper/orders?offset=-1",
			expected: papertrading.ErrInvalidOffset,
		},
		{
			name:     "invalid side",
			target:   "/api/paper/orders?side=hold",
			expected: papertrading.ErrInvalidOrderSide,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			request := httptest.NewRequest(http.MethodGet, test.target, nil)
			_, err := parseOrderFilter(request)
			if !errors.Is(err, test.expected) {
				t.Fatalf("expected %v, got %v", test.expected, err)
			}
		})
	}
}
