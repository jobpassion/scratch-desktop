try:
    import ble_uart_repl
    ble_uart_repl.start('YY-Board')
except Exception as error:
    print('BLE REPL startup failed:', error)
