package marketdata

import (
	"context"
	"errors"
	"testing"

	kafka "github.com/segmentio/kafka-go"
)

func TestConsumerCommitsRejectedTickAndContinues(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	reader := &fakeMessageReader{
		cancel: cancel,
		messages: []kafka.Message{
			{Value: []byte(`{"symbol":"BTCUSDT","price":-1,"source":"mock","timestamp":"2026-04-25T00:00:00Z"}`)},
			{Value: []byte(`{"symbol":"ETHUSDT","price":2500,"source":"mock","timestamp":"2026-04-25T00:00:01Z"}`)},
		},
	}
	applier := &rejectingTickApplier{}
	consumer := newConsumerWithReader(reader, applier)

	if err := consumer.Run(ctx); err != nil {
		t.Fatalf("expected consumer to stop cleanly after context cancel, got %v", err)
	}

	if !reader.closed {
		t.Fatal("expected consumer to close reader")
	}
	if len(reader.committed) != 2 {
		t.Fatalf("expected rejected and accepted ticks to be committed, got %d", len(reader.committed))
	}
	if len(applier.attempted) != 2 {
		t.Fatalf("expected consumer to continue after rejected tick, got attempts %+v", applier.attempted)
	}
	if applier.attempted[1].Symbol != "ETHUSDT" {
		t.Fatalf("expected second tick to be applied after rejection, got %+v", applier.attempted[1])
	}
}

type fakeMessageReader struct {
	messages  []kafka.Message
	committed []kafka.Message
	cancel    context.CancelFunc
	index     int
	closed    bool
}

func (f *fakeMessageReader) FetchMessage(_ context.Context) (kafka.Message, error) {
	if f.index >= len(f.messages) {
		if f.cancel != nil {
			f.cancel()
		}
		return kafka.Message{}, context.Canceled
	}
	message := f.messages[f.index]
	f.index++
	return message, nil
}

func (f *fakeMessageReader) CommitMessages(_ context.Context, messages ...kafka.Message) error {
	f.committed = append(f.committed, messages...)
	return nil
}

func (f *fakeMessageReader) Close() error {
	f.closed = true
	return nil
}

type rejectingTickApplier struct {
	attempted []PriceTickV1
}

func (a *rejectingTickApplier) ApplyMarketPrice(tick PriceTickV1) error {
	a.attempted = append(a.attempted, tick)
	if tick.Price <= 0 {
		return errors.New("invalid price")
	}
	return nil
}
