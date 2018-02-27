# Part of Odoo. See LICENSE file for full copyright and licensing details.

try:
    from unittest.mock import patch
except ImportError:
    from mock import patch

from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install')
class TestBarcodeClientAction(HttpCase):
    def setUp(self):
        super(TestBarcodeClientAction, self).setUp()
        global CALL_COUNT
        CALL_COUNT = 0
        self.supplier_location = self.env.ref('stock.stock_location_suppliers')
        self.stock_location = self.env.ref('stock.stock_location_stock')
        self.customer_location = self.env.ref('stock.stock_location_customers')
        self.pack_location = self.env.ref('stock.location_pack_zone')
        self.shelf1 = self.env.ref('stock.stock_location_components')
        self.shelf2 = self.env.ref('stock.stock_location_14')
        self.shelf3 = self.env['stock.location'].create({
            'name': 'Shelf 3',
            'location_id': self.stock_location.id,
            'barcode': 'shelf3',
        })
        self.shelf4 = self.env['stock.location'].create({
            'name': 'Shelf 4',
            'location_id': self.stock_location.id,
            'barcode': 'shelf4',
        })
        self.picking_type_in = self.env.ref('stock.picking_type_in')
        self.picking_type_internal = self.env.ref('stock.picking_type_internal')
        self.picking_type_out = self.env.ref('stock.picking_type_out')

        self.uom_unit = self.env.ref('uom.product_uom_unit')
        self.uom_dozen = self.env.ref('uom.product_uom_dozen')

        # Two stockable products without tracking
        self.product1 = self.env['product.product'].create({
            'name': 'product1',
            'type': 'product',
            'categ_id': self.env.ref('product.product_category_all').id,
            'barcode': 'product1',
        })
        self.product2 = self.env['product.product'].create({
            'name': 'product2',
            'type': 'product',
            'categ_id': self.env.ref('product.product_category_all').id,
            'barcode': 'product2',
        })
        self.productserial1 = self.env['product.product'].create({
            'name': 'productserial1',
            'type': 'product',
            'categ_id': self.env.ref('product.product_category_all').id,
            'barcode': 'productserial1',
            'tracking': 'serial',
        })
        self.productlot1 = self.env['product.product'].create({
            'name': 'productlot1',
            'type': 'product',
            'categ_id': self.env.ref('product.product_category_all').id,
            'barcode': 'productlot1',
            'tracking': 'lot',
        })

    def tearDown(self):
        global CALL_COUNT
        CALL_COUNT = 0
        super(TestBarcodeClientAction, self).tearDown()

    def _get_client_action_url(self, picking_id):
        return '/web#model=stock.picking&picking_id=%s&action=stock_barcode_picking_client_action' % picking_id

    def test_internal_picking_from_scratch_1(self):
        """ Open an empty internal picking
          - move 2 `self.product1` from shelf1 to shelf2
          - move 1 `self.product2` from shelf1 to shelf3
          - move 1 `self.product2` from shelf1 to shelf2
        Test all these operations only by scanning barcodes.
        """
        grp_multi_loc = self.env.ref('stock.group_stock_multi_locations')
        self.env.user.write({'groups_id': [(4, grp_multi_loc.id, 0)]})
        internal_picking = self.env['stock.picking'].create({
            'location_id': self.stock_location.id,
            'location_dest_id': self.stock_location.id,
            'picking_type_id': self.picking_type_internal.id,
        })
        picking_write_orig = internal_picking.write
        url = self._get_client_action_url(internal_picking.id)

        # Mock the calls to write and run the phantomjs script.
        product1 = self.product1
        product2 = self.product2
        shelf1 = self.shelf1
        shelf2 = self.shelf2
        shelf3 = self.shelf3
        assertEqual = self.assertEqual
        def picking_write_mock(self, vals):
            global CALL_COUNT
            CALL_COUNT += 1
            cmd = vals['move_line_ids'][0]
            write_vals = cmd[2]
            if CALL_COUNT == 1:
                assertEqual(cmd[0], 0)
                assertEqual(cmd[1], 0)
                assertEqual(write_vals['product_id'], product1.id)
                assertEqual(write_vals['picking_id'], internal_picking.id)
                assertEqual(write_vals['location_id'], shelf1.id)
                assertEqual(write_vals['location_dest_id'], shelf2.id)
                assertEqual(write_vals['qty_done'], 2)
            elif CALL_COUNT == 2:
                assertEqual(cmd[0], 0)
                assertEqual(cmd[1], 0)
                assertEqual(write_vals['product_id'], product2.id)
                assertEqual(write_vals['picking_id'], internal_picking.id)
                assertEqual(write_vals['location_id'], shelf1.id)
                assertEqual(write_vals['location_dest_id'], shelf3.id)
                assertEqual(write_vals['qty_done'], 1)
            elif CALL_COUNT == 3:
                assertEqual(cmd[0], 0)
                assertEqual(cmd[1], 0)
                assertEqual(write_vals['product_id'], product2.id)
                assertEqual(write_vals['picking_id'], internal_picking.id)
                assertEqual(write_vals['location_id'], shelf1.id)
                assertEqual(write_vals['location_dest_id'], shelf2.id)
                assertEqual(write_vals['qty_done'], 1)
            return picking_write_orig(vals)

        with patch('odoo.addons.stock.models.stock_picking.Picking.write', new=picking_write_mock):
            self.phantom_js(
                url,
                "odoo.__DEBUG__.services['web_tour.tour'].run('test_internal_picking_from_scratch_1')",
                "odoo.__DEBUG__.services['web_tour.tour'].tours.test_internal_picking_from_scratch_1.ready",
                login='admin',
                timeout=180,
            )
            self.assertEqual(CALL_COUNT, 3)

        self.assertEqual(len(internal_picking.move_line_ids), 3)

    def test_internal_picking_from_scratch_2(self):
        """ Open an empty internal picking
          - move 2 `self.product1` from shelf1 to shelf2
          - move 1 `self.product2` from shelf1 to shelf3
          - move 1 `self.product2` from shelf1 to shelf2
        Test all these operations only by using the embedded form views.
        """
        grp_multi_loc = self.env.ref('stock.group_stock_multi_locations')
        self.env.user.write({'groups_id': [(4, grp_multi_loc.id, 0)]})
        internal_picking = self.env['stock.picking'].create({
            'location_id': self.stock_location.id,
            'location_dest_id': self.stock_location.id,
            'picking_type_id': self.picking_type_internal.id,
        })
        picking_write_orig = internal_picking.write
        url = self._get_client_action_url(internal_picking.id)

        self.phantom_js(
            url,
            "odoo.__DEBUG__.services['web_tour.tour'].run('test_internal_picking_from_scratch_2')",
            "odoo.__DEBUG__.services['web_tour.tour'].tours.test_internal_picking_from_scratch_2.ready",
            login='admin',
            timeout=180,
        )

        self.assertEqual(len(internal_picking.move_line_ids), 4)
        prod1_ml = internal_picking.move_line_ids.filtered(lambda ml: ml.product_id.id == self.product1.id)
        self.assertEqual(prod1_ml[0].qty_done, 2)
        self.assertEqual(prod1_ml[1].qty_done, 1)

    def test_internal_picking_reserved_1(self):
        """ Open a reserved internal picking
          - move 1 `self.product1` and 1 `self.product2` from shelf1 to shelf2
          - move 1`self.product1` from shelf3 to shelf4.
        Before doing the reservation, move 1 `self.product1` from shelf3 to shelf2
        """
        grp_multi_loc = self.env.ref('stock.group_stock_multi_locations')
        self.env.user.write({'groups_id': [(4, grp_multi_loc.id, 0)]})
        internal_picking = self.env['stock.picking'].create({
            'location_id': self.stock_location.id,
            'location_dest_id': self.stock_location.id,
            'picking_type_id': self.picking_type_internal.id,
        })
        picking_write_orig = internal_picking.write
        url = self._get_client_action_url(internal_picking.id)

        # prepare the picking
        self.env['stock.quant']._update_available_quantity(self.product1, self.shelf1, 1)
        self.env['stock.quant']._update_available_quantity(self.product2, self.shelf1, 1)
        self.env['stock.quant']._update_available_quantity(self.product2, self.shelf3, 1)
        move1 = self.env['stock.move'].create({
            'name': 'test_internal_picking_reserved_1_1',
            'location_id': self.stock_location.id,
            'location_dest_id': self.stock_location.id,
            'product_id': self.product1.id,
            'product_uom': self.uom_unit.id,
            'product_uom_qty': 1,
            'picking_id': internal_picking.id,
        })
        move2 = self.env['stock.move'].create({
            'name': 'test_internal_picking_reserved_1_2',
            'location_id': self.stock_location.id,
            'location_dest_id': self.stock_location.id,
            'product_id': self.product2.id,
            'product_uom': self.uom_unit.id,
            'product_uom_qty': 2,
            'picking_id': internal_picking.id,
        })
        internal_picking.action_confirm()
        internal_picking.action_assign()
        move1.move_line_ids.location_dest_id = self.shelf2.id
        for ml in move2.move_line_ids:
            if ml.location_id.id == self.shelf1.id:
                ml.location_dest_id = self.shelf2.id
            else:
                ml.location_dest_id = self.shelf4.id

        # Mock the calls to write and run the phantomjs script.
        product1 = self.product1
        product2 = self.product2
        shelf1 = self.shelf1
        shelf2 = self.shelf2
        shelf3 = self.shelf3
        assertEqual = self.assertEqual
        def picking_write_mock (self, vals):
            global CALL_COUNT
            CALL_COUNT += 1
            cmd = vals['move_line_ids'][0]
            write_vals = cmd[2]
            if CALL_COUNT == 1:
                assertEqual(cmd[0], 0)
                assertEqual(cmd[1], 0)
                assertEqual(write_vals['product_id'], product1.id)
                assertEqual(write_vals['picking_id'], internal_picking.id)
                assertEqual(write_vals['location_id'], shelf3.id)
                assertEqual(write_vals['location_dest_id'], shelf2.id)
                assertEqual(write_vals['qty_done'], 1)
            return picking_write_orig(vals)

        with patch('odoo.addons.stock.models.stock_picking.Picking.write', new=picking_write_mock):
            self.phantom_js(
                url,
                "odoo.__DEBUG__.services['web_tour.tour'].run('test_internal_picking_reserved_1')",
                "odoo.__DEBUG__.services['web_tour.tour'].tours.test_internal_picking_reserved_1.ready",
                login='admin',
                timeout=180,
            )
            self.assertEqual(CALL_COUNT, 2)

    def test_receipt_from_scratch_with_lots_1(self):
        grp_multi_loc = self.env.ref('stock.group_stock_multi_locations')
        grp_lot = self.env.ref('stock.group_production_lot')
        self.env.user.write({'groups_id': [(4, grp_multi_loc.id, 0)]})
        self.env.user.write({'groups_id': [(4, grp_lot.id, 0)]})

        receipt_picking = self.env['stock.picking'].create({
            'location_id': self.supplier_location.id,
            'location_dest_id': self.stock_location.id,
            'picking_type_id': self.picking_type_in.id,
        })
        url = self._get_client_action_url(receipt_picking.id)
        self.phantom_js(
            url,
            "odoo.__DEBUG__.services['web_tour.tour'].run('test_receipt_from_scratch_with_lots_1')",
            "odoo.__DEBUG__.services['web_tour.tour'].tours.test_receipt_from_scratch_with_lots_1.ready",
            login='admin',
            timeout=180,
        )
        self.assertEqual(receipt_picking.move_line_ids.mapped('lot_name'), ['lot1', 'lot2'])

    def test_receipt_from_scratch_with_lots_2(self):
        grp_multi_loc = self.env.ref('stock.group_stock_multi_locations')
        grp_lot = self.env.ref('stock.group_production_lot')
        self.env.user.write({'groups_id': [(4, grp_multi_loc.id, 0)]})
        self.env.user.write({'groups_id': [(4, grp_lot.id, 0)]})

        receipt_picking = self.env['stock.picking'].create({
            'location_id': self.supplier_location.id,
            'location_dest_id': self.stock_location.id,
            'picking_type_id': self.picking_type_in.id,
        })
        url = self._get_client_action_url(receipt_picking.id)
        self.phantom_js(
            url,
            "odoo.__DEBUG__.services['web_tour.tour'].run('test_receipt_from_scratch_with_lots_2')",
            "odoo.__DEBUG__.services['web_tour.tour'].tours.test_receipt_from_scratch_with_lots_2.ready",
            login='admin',
            timeout=180,
        )
        self.assertEqual(receipt_picking.move_line_ids.mapped('lot_name'), ['lot1', 'lot2'])
        self.assertEqual(receipt_picking.move_line_ids.mapped('qty_done'), [2, 2])

    def test_receipt_reserved_1(self):
        """ Open a receipt. Move a unit of `self.product1` into shelf1, shelf2, shelf3 and shelf 4.
        Move a unit of `self.product2` into shelf1, shelf2, shelf3 and shelf4 too.
        """
        grp_multi_loc = self.env.ref('stock.group_stock_multi_locations')
        self.env.user.write({'groups_id': [(4, grp_multi_loc.id, 0)]})
        receipt_picking = self.env['stock.picking'].create({
            'location_id': self.supplier_location.id,
            'location_dest_id': self.stock_location.id,
            'picking_type_id': self.picking_type_in.id,
        })
        picking_write_orig = receipt_picking.write
        url = self._get_client_action_url(receipt_picking.id)

        move1 = self.env['stock.move'].create({
            'name': 'test_receipt_reserved_1_1',
            'location_id': self.supplier_location.id,
            'location_dest_id': self.stock_location.id,
            'product_id': self.product1.id,
            'product_uom': self.uom_unit.id,
            'product_uom_qty': 4,
            'picking_id': receipt_picking.id,
        })
        move2 = self.env['stock.move'].create({
            'name': 'test_receipt_reserved_1_2',
            'location_id': self.supplier_location.id,
            'location_dest_id': self.stock_location.id,
            'product_id': self.product2.id,
            'product_uom': self.uom_unit.id,
            'product_uom_qty': 4,
            'picking_id': receipt_picking.id,
        })
        receipt_picking.action_confirm()
        receipt_picking.action_assign()

        # Mock the calls to write and run the phantomjs script.
        product1 = self.product1
        product2 = self.product2
        shelf1 = self.shelf1
        shelf2 = self.shelf2
        shelf3 = self.shelf3
        sehfl4 = self.shelf4
        assertEqual = self.assertEqual
        ml1 = move1.move_line_ids
        ml2 = move2.move_line_ids
        def picking_write_mock (self, vals):
            global CALL_COUNT
            CALL_COUNT += 1
            if CALL_COUNT == 1:
                assertEqual(len(vals['move_line_ids']), 2)
                assertEqual(vals['move_line_ids'][0][:2], [1, ml1.id])
                assertEqual(vals['move_line_ids'][1][:2], [1, ml2.id])
            return picking_write_orig(vals)

        with patch('odoo.addons.stock.models.stock_picking.Picking.write', new=picking_write_mock):
            self.phantom_js(
                url,
                "odoo.__DEBUG__.services['web_tour.tour'].run('test_receipt_reserved_1')",
                "odoo.__DEBUG__.services['web_tour.tour'].tours.test_receipt_reserved_1.ready",
                login='admin',
                timeout=180,
            )
            self.assertEqual(CALL_COUNT, 1)

    def test_delivery_reserved_1(self):
        grp_multi_loc = self.env.ref('stock.group_stock_multi_locations')
        self.env.user.write({'groups_id': [(4, grp_multi_loc.id, 0)]})
        delivery_picking = self.env['stock.picking'].create({
            'location_id': self.stock_location.id,
            'location_dest_id': self.customer_location.id,
            'picking_type_id': self.picking_type_out.id,
        })
        picking_write_orig = delivery_picking.write
        url = self._get_client_action_url(delivery_picking.id)

        move1 = self.env['stock.move'].create({
            'name': 'test_delivery_reserved_1_1',
            'location_id': self.stock_location.id,
            'location_dest_id': self.customer_location.id,
            'product_id': self.product1.id,
            'product_uom': self.uom_unit.id,
            'product_uom_qty': 4,
            'picking_id': delivery_picking.id,
        })
        move2 = self.env['stock.move'].create({
            'name': 'test_delivery_reserved_1_2',
            'location_id': self.stock_location.id,
            'location_dest_id': self.customer_location.id,
            'product_id': self.product2.id,
            'product_uom': self.uom_unit.id,
            'product_uom_qty': 4,
            'picking_id': delivery_picking.id,
        })

        self.env['stock.quant']._update_available_quantity(self.product1, self.stock_location, 4)
        self.env['stock.quant']._update_available_quantity(self.product2, self.stock_location, 4)

        delivery_picking.action_confirm()
        delivery_picking.action_assign()

        # Mock the calls to write and run the phantomjs script.
        product1 = self.product1
        product2 = self.product2
        stock_location = self.stock_location
        assertEqual = self.assertEqual
        def picking_write_mock (self, vals):
            global CALL_COUNT
            CALL_COUNT += 1
            return picking_write_orig(vals)
        with patch('odoo.addons.stock.models.stock_picking.Picking.write', new=picking_write_mock):
            self.phantom_js(
                url,
                "odoo.__DEBUG__.services['web_tour.tour'].run('test_delivery_reserved_1')",
                "odoo.__DEBUG__.services['web_tour.tour'].tours.test_delivery_reserved_1.ready",
                login='admin',
                timeout=180,
            )
            self.assertEqual(CALL_COUNT, 1)

    def test_delivery_from_scratch_1(self):
        """ Scan unreserved lots on a delivery order.
        """

        grp_lot = self.env.ref('stock.group_production_lot')
        self.env.user.write({'groups_id': [(4, grp_lot.id, 0)]})

        # Add lot1 et lot2 sur productlot1
        lotObj = self.env['stock.production.lot']
        lot1 = lotObj.create({'name': 'lot1', 'product_id': self.productlot1.id})
        lot2 = lotObj.create({'name': 'lot2', 'product_id': self.productlot1.id})

        # empty picking
        delivery_picking = self.env['stock.picking'].create({
            'location_id': self.stock_location.id,
            'location_dest_id': self.customer_location.id,
            'picking_type_id': self.picking_type_out.id,
        })
        url = self._get_client_action_url(delivery_picking.id)

        self.phantom_js(
            url,
            "odoo.__DEBUG__.services['web_tour.tour'].run('test_delivery_from_scratch_with_lots_1')",
            "odoo.__DEBUG__.services['web_tour.tour'].tours.test_delivery_from_scratch_with_lots_1.ready",
            login='admin',
            timeout=180,
        )

        lines = delivery_picking.move_line_ids
        self.assertEqual(lines[0].lot_id.name, 'lot1')
        self.assertEqual(lines[1].lot_id.name, 'lot2')
        self.assertEqual(lines[0].qty_done, 2)
        self.assertEqual(lines[1].qty_done, 2)

    def test_delivery_from_scratch_sn_1(self):
        """ Scan unreserved serial number on a delivery order.
        """

        grp_lot = self.env.ref('stock.group_production_lot')
        self.env.user.write({'groups_id': [(4, grp_lot.id, 0)]})

        # Add 4 serial numbers productserial1
        snObj = self.env['stock.production.lot']
        sn1 = snObj.create({'name': 'sn1', 'product_id': self.productserial1.id})
        sn2 = snObj.create({'name': 'sn2', 'product_id': self.productserial1.id})
        sn3 = snObj.create({'name': 'sn3', 'product_id': self.productserial1.id})
        sn4 = snObj.create({'name': 'sn4', 'product_id': self.productserial1.id})

        # empty picking
        delivery_picking = self.env['stock.picking'].create({
            'location_id': self.stock_location.id,
            'location_dest_id': self.customer_location.id,
            'picking_type_id': self.picking_type_out.id,
        })
        url = self._get_client_action_url(delivery_picking.id)

        self.phantom_js(
            url,
            "odoo.__DEBUG__.services['web_tour.tour'].run('test_delivery_from_scratch_with_sn_1')",
            "odoo.__DEBUG__.services['web_tour.tour'].tours.test_delivery_from_scratch_with_sn_1.ready",
            login='admin',
            timeout=180,
        )

        lines = delivery_picking.move_line_ids
        self.assertEqual(lines.mapped('lot_id.name'), ['sn1', 'sn2', 'sn3', 'sn4'])
        self.assertEqual(lines.mapped('qty_done'), [1, 1, 1, 1])

    def test_delivery_reserved_lots_1(self):
        grp_lot = self.env.ref('stock.group_production_lot')
        self.env.user.write({'groups_id': [(4, grp_lot.id, 0)]})

        delivery_picking = self.env['stock.picking'].create({
            'location_id': self.stock_location.id,
            'location_dest_id': self.customer_location.id,
            'picking_type_id': self.picking_type_out.id,
        })
        url = self._get_client_action_url(delivery_picking.id)

        move1 = self.env['stock.move'].create({
            'name': 'test_delivery_reserved_lots_1',
            'location_id': self.stock_location.id,
            'location_dest_id': self.customer_location.id,
            'product_id': self.productlot1.id,
            'product_uom': self.uom_unit.id,
            'product_uom_qty': 3,
            'picking_id': delivery_picking.id,
        })

        # Add lot1 et lot2 sur productlot1
        lotObj = self.env['stock.production.lot']
        lot1 = lotObj.create({'name': 'lot1', 'product_id': self.productlot1.id})
        lot2 = lotObj.create({'name': 'lot2', 'product_id': self.productlot1.id})

        self.env['stock.quant']._update_available_quantity(self.productlot1, self.stock_location, 1, lot_id=lot1)
        self.env['stock.quant']._update_available_quantity(self.productlot1, self.stock_location, 2, lot_id=lot2)

        delivery_picking.action_confirm()
        delivery_picking.action_assign()
        self.assertEqual(delivery_picking.move_lines.state, 'assigned')
        self.assertEqual(len(delivery_picking.move_lines.move_line_ids), 2)

        self.phantom_js(
            url,
            "odoo.__DEBUG__.services['web_tour.tour'].run('test_delivery_reserved_lots_1')",
            "odoo.__DEBUG__.services['web_tour.tour'].tours.test_delivery_reserved_lots_1.ready",
            login='admin',
            timeout=180,
        )

        delivery_picking.invalidate_cache()
        lines = delivery_picking.move_line_ids
        self.assertEqual(lines[0].lot_id.name, 'lot1')
        self.assertEqual(lines[1].lot_id.name, 'lot2')
        self.assertEqual(lines[0].qty_done, 1)
        self.assertEqual(lines[1].qty_done, 2)

    def test_delivery_from_scratch_sn_1(self):
        """ Scan unreserved serial number on a delivery order.
        """

        grp_lot = self.env.ref('stock.group_production_lot')
        self.env.user.write({'groups_id': [(4, grp_lot.id, 0)]})

        # Add 4 serial numbers productserial1
        snObj = self.env['stock.production.lot']
        sn1 = snObj.create({'name': 'sn1', 'product_id': self.productserial1.id})
        sn2 = snObj.create({'name': 'sn2', 'product_id': self.productserial1.id})
        sn3 = snObj.create({'name': 'sn3', 'product_id': self.productserial1.id})
        sn4 = snObj.create({'name': 'sn4', 'product_id': self.productserial1.id})

        self.env['stock.quant']._update_available_quantity(self.productserial1, self.stock_location, 1, lot_id=sn1)
        self.env['stock.quant']._update_available_quantity(self.productserial1, self.stock_location, 1, lot_id=sn2)
        self.env['stock.quant']._update_available_quantity(self.productserial1, self.stock_location, 1, lot_id=sn3)
        self.env['stock.quant']._update_available_quantity(self.productserial1, self.stock_location, 1, lot_id=sn4)

        # empty picking
        delivery_picking = self.env['stock.picking'].create({
            'location_id': self.stock_location.id,
            'location_dest_id': self.customer_location.id,
            'picking_type_id': self.picking_type_out.id,
        })

        move1 = self.env['stock.move'].create({
            'name': 'test_delivery_reserved_lots_1',
            'location_id': self.stock_location.id,
            'location_dest_id': self.customer_location.id,
            'product_id': self.productserial1.id,
            'product_uom': self.uom_unit.id,
            'product_uom_qty': 4,
            'picking_id': delivery_picking.id,
        })

        delivery_picking.action_confirm()
        delivery_picking.action_assign()

        url = self._get_client_action_url(delivery_picking.id)

        self.phantom_js(
            url,
            "odoo.__DEBUG__.services['web_tour.tour'].run('test_delivery_reserved_with_sn_1')",
            "odoo.__DEBUG__.services['web_tour.tour'].tours.test_delivery_reserved_with_sn_1.ready",
            login='admin',
            timeout=180,
        )

        # TODO: the framework should call invalidate_cache every time a test cursor is asked or
        #       given back
        delivery_picking.invalidate_cache()
        lines = delivery_picking.move_line_ids
        self.assertEqual(lines.mapped('lot_id.name'), ['sn1', 'sn2', 'sn3', 'sn4'])
        self.assertEqual(lines.mapped('qty_done'), [1, 1, 1, 1])

    def test_receipt_reserved_lots_multiloc_1(self):
        grp_multi_loc = self.env.ref('stock.group_stock_multi_locations')
        self.env.user.write({'groups_id': [(4, grp_multi_loc.id, 0)]})
        grp_lot = self.env.ref('stock.group_production_lot')
        self.env.user.write({'groups_id': [(4, grp_lot.id, 0)]})

        receipts_picking = self.env['stock.picking'].create({
            'location_id': self.supplier_location.id,
            'location_dest_id': self.stock_location.id,
            'picking_type_id': self.picking_type_in.id,
        })

        url = self._get_client_action_url(receipts_picking.id)

        move1 = self.env['stock.move'].create({
            'name': 'test_delivery_reserved_lots_1',
            'location_id': self.supplier_location.id,
            'location_dest_id': self.stock_location.id,
            'product_id': self.productlot1.id,
            'product_uom': self.uom_unit.id,
            'product_uom_qty': 4,
            'picking_id': receipts_picking.id,
        })

        # Add lot1 et lot2 sur productlot1
        lotObj = self.env['stock.production.lot']
        lot1 = lotObj.create({'name': 'lot1', 'product_id': self.productlot1.id})
        lot2 = lotObj.create({'name': 'lot2', 'product_id': self.productlot1.id})

        receipts_picking.action_confirm()
        receipts_picking.action_assign()

        self.phantom_js(
            url,
            "odoo.__DEBUG__.services['web_tour.tour'].run('test_receipt_reserved_lots_multiloc_1')",
            "odoo.__DEBUG__.services['web_tour.tour'].tours.test_receipt_reserved_lots_multiloc_1.ready",
            login='admin',
            timeout=180,
        )
        receipts_picking.invalidate_cache()
        lines = receipts_picking.move_line_ids
        self.assertEqual(lines[0].qty_done, 0.0)
        self.assertEqual(lines[0].product_qty, 4.0)
        self.assertEqual(lines.mapped('location_id.name'), ['Vendors'])
        self.assertEqual(lines[1].lot_name, 'lot1')
        self.assertEqual(lines[2].lot_name, 'lot2')
        self.assertEqual(lines[1].qty_done, 2)
        self.assertEqual(lines[2].qty_done, 2)
        self.assertEqual(lines[1].location_dest_id.name, 'Shelf 2')
        self.assertEqual(lines[2].location_dest_id.name, 'Shelf 1')

    def test_inventory_adjustment(self):
        """ Simulate the following actions:
        - Open the inventory from the barcode app.
        - Scan twice the product 1.
        - Edit the line.
        - Add a product by click and form view.
        - Validate
        """

        action_id = self.env.ref('stock_barcode.stock_barcode_action_main_menu')
        url = "/web#action=" + str(action_id.id)

        self.phantom_js(
            url,
            "odoo.__DEBUG__.services['web_tour.tour'].run('test_inventory_adjustment')",
            "odoo.__DEBUG__.services['web_tour.tour'].tours.test_inventory_adjustment.ready",
            login='admin',
            timeout=180,
        )

        inventory = self.env['stock.inventory.line'].search([('product_id', '=', self.product1.id)]).inventory_id
        self.assertTrue(inventory)
        self.assertEqual(set(inventory.line_ids.mapped('product_id')), set([self.product1, self.product2]))
        self.assertEqual(len(inventory.line_ids), 2)
        self.assertEqual(inventory.line_ids.mapped('product_qty'), [2.0, 2.0])

    def test_inventory_adjustment_mutli_location(self):
        """ Simulate the following actions:
        - Generate those lines with scan:
        WH/stock product1 qty: 2
        WH/stock product2 qty: 1
        WH/stock/shelf1 product2 qty: 1
        WH/stock/shelf2 product1 qty: 1
        - Validate
        """

        grp_multi_loc = self.env.ref('stock.group_stock_multi_locations')
        self.env.user.write({'groups_id': [(4, grp_multi_loc.id, 0)]})

        action_id = self.env.ref('stock_barcode.stock_barcode_action_main_menu')
        url = "/web#action=" + str(action_id.id)

        self.phantom_js(
            url,
            "odoo.__DEBUG__.services['web_tour.tour'].run('test_inventory_adjustment_mutli_location')",
            "odoo.__DEBUG__.services['web_tour.tour'].tours.test_inventory_adjustment_mutli_location.ready",
            login='admin',
            timeout=180,
        )

        inventory = self.env['stock.inventory.line'].search([('product_id', '=', self.product1.id)], limit=1).inventory_id
        self.assertTrue(inventory)
        self.assertEqual(len(inventory.line_ids), 4)
        inventory_line_in_WH_stock = inventory.line_ids.filtered(lambda l: l.location_id == self.stock_location)
        self.assertEqual(set(inventory_line_in_WH_stock.mapped('product_id')), set([self.product1, self.product2]))
        self.assertEqual(inventory_line_in_WH_stock.filtered(lambda l: l.product_id == self.product1).product_qty, 2.0)
        self.assertEqual(inventory_line_in_WH_stock.filtered(lambda l: l.product_id == self.product2).product_qty, 1.0)

        inventory_line_in_shelf1 = inventory.line_ids.filtered(lambda l: l.location_id == self.shelf1)
        self.assertEqual(len(inventory_line_in_shelf1), 1)
        self.assertEqual(inventory_line_in_shelf1.product_id, self.product2)
        self.assertEqual(inventory_line_in_shelf1.product_qty, 1.0)

        inventory_line_in_shelf2 = inventory.line_ids.filtered(lambda l: l.location_id == self.shelf2)
        self.assertEqual(len(inventory_line_in_shelf2), 1)
        self.assertEqual(inventory_line_in_shelf2.product_id, self.product1)
        self.assertEqual(inventory_line_in_shelf2.product_qty, 1.0)

    def test_inventory_adjustment_tracked_product(self):
        """ Simulate the following actions:
        - Generate those lines with scan:
        productlot1 with a lot named lot1 (qty 3)
        productserial1 with serial1 (qty 1)
        productserial1 with serial2 (qty 1)
        productserial1 with serial3 (qty 1)
        - Validate
        """

        grp_lot = self.env.ref('stock.group_production_lot')
        self.env.user.write({'groups_id': [(4, grp_lot.id, 0)]})

        action_id = self.env.ref('stock_barcode.stock_barcode_action_main_menu')
        url = "/web#action=" + str(action_id.id)

        self.phantom_js(
            url,
            "odoo.__DEBUG__.services['web_tour.tour'].run('test_inventory_adjustment_tracked_product')",
            "odoo.__DEBUG__.services['web_tour.tour'].tours.test_inventory_adjustment_tracked_product.ready",
            login='admin',
            timeout=180,
        )

        inventory = self.env['stock.inventory.line'].search([('product_id', '=', self.productlot1.id)], limit=1).inventory_id
        self.assertTrue(inventory)
        self.assertEqual(len(inventory.line_ids), 4)

        lines_with_lot = inventory.line_ids.filtered(lambda l: l.product_id == self.productlot1)
        lines_with_sn = inventory.line_ids.filtered(lambda l: l.product_id == self.productserial1)

        self.assertEqual(len(lines_with_lot), 1)
        self.assertEqual(len(lines_with_sn), 3)
        self.assertEqual(lines_with_lot.prod_lot_id.name, 'lot1')
        self.assertEqual(lines_with_lot.product_qty, 3)
        self.assertEqual(set(lines_with_sn.mapped('prod_lot_id.name')), set(['serial1', 'serial2', 'serial3']))