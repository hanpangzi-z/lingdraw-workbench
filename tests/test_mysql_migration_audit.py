import unittest
from ops.mysql.audit_snapshot import audit_billing


class BillingAuditTests(unittest.TestCase):
    def test_old_charges_and_new_ledger_are_reconciled_without_double_counting(self):
        users={1:{'credit_balance':83}}
        ledger=[{'user_id':1,'delta':100,'usage_event_id':''},
                {'user_id':1,'delta':-10,'usage_event_id':'new'},
                {'user_id':1,'delta':3,'usage_event_id':'new'}]
        usage=[{'id':'old','user_id':1,'charged_points':10,'debited_points':0,'refunded_points':0},
               {'id':'new','user_id':1,'charged_points':7,'debited_points':10,'refunded_points':3}]
        reconciled,issues=audit_billing(users,ledger,usage)
        self.assertEqual(issues,[])
        self.assertEqual(reconciled[0]['expected_balance'],83)
        ledger[-1]['delta']=4
        _,issues=audit_billing(users,ledger,usage)
        self.assertEqual({i['kind'] for i in issues},{'ledger_balance','usage_ledger_amount'})

    def test_missing_new_debit_ledger_is_not_misclassified_as_legacy(self):
        _,issues=audit_billing({1:{'credit_balance':0}},[],[{'id':'missing','user_id':1,'charged_points':4,'debited_points':4,'refunded_points':0}])
        self.assertEqual(issues,[{'kind':'missing_usage_ledger','event_id':'missing'}])

if __name__=='__main__': unittest.main()
