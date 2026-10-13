import unittest
from unittest.mock import patch
import main


class PptChatSelectionTests(unittest.TestCase):
    def test_default_uses_configured_chat_provider_not_unconfigured_workflow(self):
        workflow = {'id': 'runninghub', 'chat_models': [], 'primary': True}
        chat = {'id': 'existing-chat', 'chat_models': ['existing-model']}
        with patch.object(main, 'load_api_providers', return_value=[workflow, chat]), \
                patch.object(main, 'runtime_provider', side_effect=lambda p: {'available': p['id'] == 'existing-chat'}), \
                patch.object(main, 'resolve_chat_provider', return_value=('', {}, 'existing-model')) as resolve:
            actual, model = main.ppt_chat_target(main.PptAIChatRequest(user_prompt='test'))
        self.assertEqual(actual, chat)
        self.assertEqual(model, 'existing-model')
        resolve.assert_called_once_with('existing-chat', '', '')

    def test_explicit_selection_is_not_replaced(self):
        explicit = {'id': 'chosen', 'chat_models': ['chosen-model']}
        with patch.object(main, 'get_api_provider', return_value=explicit) as get, \
                patch.object(main, 'resolve_chat_provider', return_value=('', {}, 'chosen-model')):
            actual, _ = main.ppt_chat_target(main.PptAIChatRequest(user_prompt='test', provider='chosen'))
        self.assertEqual(actual, explicit)
        get.assert_called_once_with('chosen')
