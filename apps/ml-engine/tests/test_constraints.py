from constraints import eligible_employee_ids
from schemas import AvailabilitySubmission, Employee


def test_pending_submission_excluded():
    employees = [
        Employee(user_id="a", role="COOK"),
        Employee(user_id="b", role="CASHIER"),
    ]
    submissions = [
        AvailabilitySubmission(user_id="a", status="approved"),
        AvailabilitySubmission(user_id="b", status="pending"),
    ]
    eligible, flags = eligible_employee_ids(employees, submissions)
    assert "a" in eligible
    assert "b" not in eligible
    assert any(f["type"] == "availability_not_approved" for f in flags)
