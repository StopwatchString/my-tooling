#include <gtest/gtest.h>

#include "SubComponent.hpp"

TEST(SubComponentTest, PrintCounting) {
    Namespace::SubComponent c;

    EXPECT_EQ(0, c.getPrintCount());

    c.print();

    EXPECT_EQ(1, c.getPrintCount());

    c.print();

    EXPECT_EQ(2, c.getPrintCount());
}
