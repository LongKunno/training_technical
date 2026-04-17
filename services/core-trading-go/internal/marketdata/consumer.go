package marketdata

import (
	"context"
	"encoding/json"

	kafka "github.com/segmentio/kafka-go"
)

type PriceTickApplier interface {
	ApplyMarketPrice(tick PriceTickV1) error
}

type Consumer struct {
	reader  *kafka.Reader
	applier PriceTickApplier
}

func NewConsumer(brokers []string, topic string, groupID string, applier PriceTickApplier) *Consumer {
	return &Consumer{
		reader: kafka.NewReader(kafka.ReaderConfig{
			Brokers: brokers,
			GroupID: groupID,
			Topic:   topic,
		}),
		applier: applier,
	}
}

func (c *Consumer) Run(ctx context.Context) error {
	defer func() {
		_ = c.reader.Close()
	}()

	for {
		message, err := c.reader.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}

		var tick PriceTickV1
		if err := json.Unmarshal(message.Value, &tick); err != nil {
			if commitErr := c.reader.CommitMessages(ctx, message); commitErr != nil {
				return commitErr
			}
			continue
		}

		if err := c.applier.ApplyMarketPrice(tick); err != nil {
			if commitErr := c.reader.CommitMessages(ctx, message); commitErr != nil {
				return commitErr
			}
			continue
		}

		if err := c.reader.CommitMessages(ctx, message); err != nil {
			return err
		}
	}
}
