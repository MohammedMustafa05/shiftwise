from historical_prior import apply_prior_to_workers, fit_prior_from_weeks


def test_fit_prior_produces_shape_not_copy():
    weeks = [
        {
            "shifts": [
                {"employee": "Kazim", "dow": 1, "start": "10:00", "end": "16:00"},
                {"employee": "Inaya", "dow": 1, "start": "17:00", "end": "22:00"},
                {"employee": "Pankaj", "dow": 5, "start": "10:00", "end": "22:00"},
            ]
        },
        {
            "shifts": [
                {"employee": "Kazim", "dow": 2, "start": "10:00", "end": "17:00"},
                {"employee": "Inaya", "dow": 5, "start": "17:00", "end": "22:00"},
            ]
        },
    ]
    model = fit_prior_from_weeks(weeks)
    assert model["weeks_trained"] == 2
    assert len(model["shift_templates"]) > 0
    assert "1" in model["dow_multiplier"]
    assert model["employee_priors"]["Kazim"]["dow_probability"]["1"] > 0


def test_apply_prior_blends_sales():
    prior = fit_prior_from_weeks(
        [
            {
                "shifts": [
                    {"employee": "A", "dow": 5, "start": "10:00", "end": "22:00"},
                    {"employee": "B", "dow": 5, "start": "10:00", "end": "22:00"},
                    {"employee": "C", "dow": 5, "start": "10:00", "end": "22:00"},
                    {"employee": "D", "dow": 5, "start": "10:00", "end": "22:00"},
                ]
            }
        ]
    )
    by_hour = [{"date": "2026-06-06", "hour": 18, "sales": 500.0, "workers": 3}]
    out = apply_prior_to_workers(by_hour, 0.2, prior, blend=0.35)
    assert out[0]["workers"] >= 3
